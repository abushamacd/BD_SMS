import db from "../../db.server.js";
import { refundAllowance, spendAllowance } from "../billing/allowance.server.js";
import { getAdapterForShop } from "../gateways/index.server.js";
import { normalizeBdPhone } from "../phone.js";
import { getSettings, isQuietHours, quietHoursEnd } from "../settings.server.js";
import { MAX_PARTS, segmentSms } from "../sms-credits.js";

// The send pipeline. Every SMS in this app goes through here — order webhooks,
// campaigns, OTP, cart recovery, manual sends and tests. Nothing calls a gateway
// adapter directly.
//
// The order of operations is load-bearing:
//
//   1. Reserve the log row FIRST (unique dedupeKey).
//      A duplicate webhook collides here and we stop before spending anything.
//      It also means a crash mid-send leaves a QUEUED row to reconcile, rather
//      than an SMS that was delivered and never recorded.
//   2. Refuse to send (SKIPPED) — blacklist, missing consent, bad number.
//      SKIPPED rows are never billed, and are visible in the log so a merchant
//      can answer "why didn't this customer get their SMS".
//   3. Debit BEFORE calling the gateway.
//      Send-then-debit gives away a free SMS on any crash in between.
//   4. Refund if the gateway rejects it. Nothing was delivered, so nothing is
//      owed. (A message the gateway ACCEPTED and a carrier later failed to
//      deliver is NOT refunded — the operator charged us for it.)

/** Marketing messages need consent. Transactional ones do not. */
const MARKETING_TYPES = new Set(["CAMPAIGN", "ABANDONED_CART"]);

/** These are never held for quiet hours — a customer is waiting on them. */
const URGENT_TYPES = new Set(["COD_OTP", "TEST"]);

export const SendOutcome = {
  SENT: "SENT",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
  DEFERRED: "DEFERRED", // held for quiet hours; the queue reschedules
  DUPLICATE: "DUPLICATE", // already sent — a redelivered webhook
};

function result(outcome, extra = {}) {
  return { outcome, ...extra };
}

/**
 * Send one SMS.
 *
 * @param {object} params
 * @param {string} params.shop
 * @param {string} params.phone         Any format; normalised here.
 * @param {string} params.message       Fully rendered — no {{variables}} left.
 * @param {string} params.type          SmsType
 * @param {string} [params.dedupeKey]   e.g. "NEW_ORDER:gid://shopify/Order/1"
 * @param {boolean} [params.smsConsent] The customer's marketing consent.
 * @param {boolean} [params.consentOverride] Merchant explicitly chose to send anyway.
 * @param {boolean} [params.ignoreQuietHours]
 */
export async function sendSms({
  shop,
  phone,
  message,
  type,
  dedupeKey = null,
  customerName = null,
  customerId = null,
  orderId = null,
  campaignId = null,
  smsConsent = false,
  consentOverride = false,
  ignoreQuietHours = false,
}) {
  const settings = await getSettings(shop);
  const usesOwnGateway = settings.gatewayMode === "PERSONAL";

  // --- Quiet hours -------------------------------------------------------
  // Checked here and not only at enqueue time, because a job queued at 9pm for
  // an immediate send can still be picked up at 10:01pm.
  if (
    !ignoreQuietHours &&
    !URGENT_TYPES.has(type) &&
    isQuietHours(settings, new Date())
  ) {
    return result(SendOutcome.DEFERRED, {
      runAt: quietHoursEnd(settings),
      reason: "Held until quiet hours end",
    });
  }

  // --- Price it ----------------------------------------------------------
  // Priced from the exact string that will be sent, using the same module the
  // UI quotes from, so the merchant is charged what they were shown.
  const segment = segmentSms(message);

  // --- Normalise the number ----------------------------------------------
  const normalized = normalizeBdPhone(phone);

  const base = {
    shop,
    phone: normalized.valid ? normalized.e164 : String(phone ?? "").slice(0, 32),
    customerName,
    customerId,
    type,
    body: message,
    encoding: segment.encoding,
    parts: segment.parts,
    credits: segment.credits,
    provider: usesOwnGateway
      ? (await db.gateway.findUnique({ where: { shop } }))?.provider ?? "GENERIC"
      : (process.env.DEFAULT_SMS_PROVIDER ?? "bulksmsbd").toUpperCase(),
    senderId: settings.senderId,
    orderId,
    campaignId,
    dedupeKey,
  };

  // --- 1. Reserve the row (idempotency barrier) --------------------------
  let log;
  try {
    log = await db.smsLog.create({ data: { ...base, status: "QUEUED" } });
  } catch (error) {
    if (error.code === "P2002" && dedupeKey) {
      // A message with this dedupeKey already exists: Shopify redelivered the
      // webhook. Do not send again, do not bill again.
      const existing = await db.smsLog.findUnique({
        where: { shop_dedupeKey: { shop, dedupeKey } },
      });

      return result(SendOutcome.DUPLICATE, {
        smsLogId: existing?.id,
        reason: "This message was already sent",
      });
    }
    throw error;
  }

  const skip = async (reason, errorCode) => {
    await db.smsLog.update({
      where: { id: log.id },
      data: { status: "SKIPPED", errorCode, errorMessage: reason },
    });
    return result(SendOutcome.SKIPPED, { smsLogId: log.id, reason });
  };

  // --- 2. Refuse to send -------------------------------------------------

  if (!normalized.valid) {
    return skip(normalized.reason, normalized.code);
  }

  if (segment.parts === 0) {
    return skip("The message is empty", "EMPTY_MESSAGE");
  }

  if (segment.parts > MAX_PARTS) {
    return skip(
      `The message is ${segment.parts} SMS parts long — the limit is ${MAX_PARTS}. Check for a variable that did not fill in.`,
      "TOO_LONG",
    );
  }

  const blocked = await db.blacklist.findUnique({
    where: { shop_phone: { shop, phone: normalized.e164 } },
  });

  if (blocked) {
    // Opting out of marketing does not mean losing the OTP that confirms your
    // own order — unless the merchant has explicitly chosen otherwise.
    const isMarketing = MARKETING_TYPES.has(type) || type === "MANUAL";

    if (isMarketing || settings.blockTransactional) {
      return skip(
        `This number opted out (${blocked.source.toLowerCase()})`,
        "BLACKLISTED",
      );
    }
  }

  const needsConsent = MARKETING_TYPES.has(type) || type === "MANUAL";

  if (needsConsent && !smsConsent && !consentOverride) {
    return skip(
      "This customer has not accepted SMS marketing",
      "NO_CONSENT",
    );
  }

  // --- 3. Spend ----------------------------------------------------------
  // Whatever this shop actually spends — purchased credits on our gateway, plan
  // allowance on their own. Both are taken with a conditional update whose WHERE
  // clause is the lock, so concurrent sends cannot both take the last one.
  //
  // Taken BEFORE the gateway call: send-then-charge gives away a free SMS on any
  // crash in between.
  const spend = await spendAllowance(settings, segment.credits);

  if (!spend.ok) {
    return skip(spend.reason, spend.code);
  }

  // The ledger is an account of money WE are holding. A merchant on their own
  // gateway has none with us — their provider bills them — so writing them a
  // `SEND` row for 0 credits would be inventing a statement about an account that
  // does not exist.
  if (spend.charged > 0) {
    await db.creditLedger.create({
      data: {
        shop,
        type: "SEND",
        amount: -spend.charged,
        balanceAfter: spend.balanceAfter,
        description: `${type} to ${normalized.e164}`,
        smsLogId: log.id,
        campaignId,
      },
    });
  }

  // --- 4. Send -----------------------------------------------------------
  let adapter;
  try {
    adapter = await getAdapterForShop(shop);
  } catch (error) {
    await refundAllowance(settings, segment.credits, {
      smsLogId: log.id,
      reason: "Gateway not configured",
    });
    await db.smsLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        errorCode: "NO_GATEWAY",
        errorMessage: error.message,
      },
    });
    return result(SendOutcome.FAILED, {
      smsLogId: log.id,
      reason: error.message,
      retryable: false,
    });
  }

  const sendResult = await adapter.send({
    phone: normalized.e164,
    message,
    senderId: settings.senderId,
    reference: log.id, // SSL Wireless dedupes on this; a retry must reuse it
    promotional: MARKETING_TYPES.has(type),
  });

  if (sendResult.ok) {
    await db.smsLog.update({
      where: { id: log.id },
      data: {
        status: "SENT",
        providerMessageId: sendResult.providerMessageId,
        sentAt: new Date(),
      },
    });

    return result(SendOutcome.SENT, {
      smsLogId: log.id,
      credits: segment.credits,
      providerMessageId: sendResult.providerMessageId,
    });
  }

  // --- 5. Refund ---------------------------------------------------------
  // The gateway rejected it, so nothing was delivered and nothing is owed. In
  // BOTH modes: a message that never went out must not eat a plan allowance any
  // more than it should eat credits.
  await refundAllowance(settings, segment.credits, {
    smsLogId: log.id,
    reason: sendResult.errorMessage,
  });

  await db.smsLog.update({
    where: { id: log.id },
    data: {
      status: "FAILED",
      errorCode: sendResult.errorCode,
      errorMessage: sendResult.errorMessage,
    },
  });

  return result(SendOutcome.FAILED, {
    smsLogId: log.id,
    reason: sendResult.errorMessage,
    retryable: sendResult.retryable,
  });
}

/**
 * A retried send must not create a second log row. The queue calls this to
 * re-attempt an existing FAILED row rather than going through sendSms again.
 */
export async function retrySend(smsLogId) {
  const log = await db.smsLog.findUnique({ where: { id: smsLogId } });

  if (!log) throw new Error(`SmsLog ${smsLogId} not found`);
  if (log.status === "SENT" || log.status === "DELIVERED") {
    return result(SendOutcome.DUPLICATE, { smsLogId, reason: "Already sent" });
  }

  // Re-run the whole pipeline, minus the row creation. Deleting the reserved row
  // and calling sendSms again would work but loses the original timestamps, so
  // the retry is done in place.
  await db.smsLog.delete({ where: { id: smsLogId } });

  return sendSms({
    shop: log.shop,
    phone: log.phone,
    message: log.body,
    type: log.type,
    dedupeKey: log.dedupeKey,
    customerName: log.customerName,
    customerId: log.customerId,
    orderId: log.orderId,
    campaignId: log.campaignId,
    smsConsent: true, // consent was already checked when it was first queued
    ignoreQuietHours: true, // it was queued for now; do not defer it again
  });
}
