import db from "../../db.server.js";
import { normalizeBdPhone } from "../phone.js";
import { enqueue } from "../queue/queue.server.js";
import { getSettings, getTemplate } from "../settings.server.js";
import { formatMoney } from "../orders/extract.server.js";
import { renderMessage } from "../templates.server.js";
import { sendSms } from "../sms/send.server.js";

// Abandoned checkout recovery.
//
// This is abandoned *checkout*, not abandoned *cart*. Shopify only gives us a
// phone number once the customer reaches checkout and enters their contact
// details — a customer who added to cart and wandered off is anonymous, and
// there is nobody to text.
//
// The sequence is a chain, not a fan-out: follow-up 1 schedules follow-up 2 only
// after it has actually sent. Scheduling all three up front would mean cancelling
// two jobs every time someone completes their order.

const FOLLOW_UP_KEYS = ["ABANDONED_CART_1", "ABANDONED_CART_2", "ABANDONED_CART_3"];

// Below transactional messages, above nothing. A cart reminder is marketing.
const FOLLOWUP_PRIORITY = -5;

/** Phone from a checkout payload. Shipping first — same reasoning as orders. */
function checkoutPhone(checkout) {
  return (
    checkout?.shipping_address?.phone ||
    checkout?.billing_address?.phone ||
    checkout?.phone ||
    checkout?.customer?.phone ||
    null
  );
}

function checkoutName(checkout) {
  const customer = checkout?.customer;
  const address = checkout?.shipping_address ?? checkout?.billing_address;

  const first = customer?.first_name || address?.first_name || "";
  const last = customer?.last_name || address?.last_name || "";

  return `${first} ${last}`.trim() || "Customer";
}

/**
 * A cart reminder is a marketing message, so it needs marketing consent — the
 * same rule as campaigns. A guest who never opted in is recorded as SKIPPED
 * rather than quietly messaged.
 */
function checkoutConsent(checkout) {
  const state =
    checkout?.customer?.sms_marketing_consent?.state ??
    checkout?.sms_marketing_consent?.state;

  return state === "subscribed";
}

/**
 * checkouts/create and checkouts/update.
 *
 * Both land here. update fires repeatedly while the customer is still typing, so
 * `abandonedAt` tracks the LAST activity — otherwise the timer would start when
 * they first reached checkout and we would text someone who is still filling in
 * their address.
 */
export async function onCheckoutUpserted({ shop, checkout }) {
  const settings = await getSettings(shop);

  // completed_at set means it became an order. Nothing to recover.
  if (checkout?.completed_at) {
    await db.abandonedCheckout.updateMany({
      where: { shop, checkoutToken: String(checkout.token ?? checkout.id) },
      data: { status: "RECOVERED", recoveredAt: new Date() },
    });

    return { stored: false, reason: "Checkout was completed" };
  }

  const token = String(checkout?.token ?? checkout?.id ?? "");

  if (!token) return { stored: false, reason: "Checkout has no token" };

  const phone = checkoutPhone(checkout);
  const normalized = normalizeBdPhone(phone);
  const consent = checkoutConsent(checkout);

  // Recorded either way — the merchant should be able to see the checkouts we
  // could not act on, and why.
  const status = !normalized.valid
    ? "SKIPPED"
    : !consent
      ? "SKIPPED"
      : "WAITING";

  const lastActivity = checkout?.updated_at
    ? new Date(checkout.updated_at)
    : new Date();

  const record = await db.abandonedCheckout.upsert({
    where: { shop_checkoutToken: { shop, checkoutToken: token } },
    create: {
      shop,
      checkoutToken: token,
      phone: normalized.valid ? normalized.e164 : (phone ?? null),
      customerName: checkoutName(checkout),
      customerId: checkout?.customer?.id ? String(checkout.customer.id) : null,
      email: checkout?.email ?? null,
      cartValue: checkout?.total_price ?? 0,
      currency: checkout?.currency ?? "BDT",
      recoveryUrl: checkout?.abandoned_checkout_url ?? "",
      smsConsent: consent,
      status,
      abandonedAt: lastActivity,
    },
    update: {
      // A customer still editing their checkout is not abandoning it. Pushing
      // abandonedAt forward pushes the reminder back.
      abandonedAt: lastActivity,
      phone: normalized.valid ? normalized.e164 : (phone ?? null),
      customerName: checkoutName(checkout),
      cartValue: checkout?.total_price ?? 0,
      recoveryUrl: checkout?.abandoned_checkout_url ?? "",
      smsConsent: consent,
      // Do not resurrect a recovered checkout, and do not restart a sequence
      // that is already running.
      ...(status === "SKIPPED" ? { status: "SKIPPED" } : {}),
    },
  });

  if (!settings.abandonedCartEnabled) {
    return { stored: true, reason: "Abandoned cart recovery is off" };
  }

  if (status === "SKIPPED") {
    return {
      stored: true,
      reason: !normalized.valid
        ? "No usable phone number"
        : "Customer did not accept SMS marketing",
    };
  }

  // Schedule the first follow-up only. Each one chains the next after it sends.
  await scheduleFollowUp(shop, record.id, 0, lastActivity);

  return { stored: true, scheduled: true };
}

/** Put follow-up `step` (0-based) on the queue. */
async function scheduleFollowUp(shop, checkoutId, step, from) {
  const template = await getTemplate(shop, FOLLOW_UP_KEYS[step]);

  if (!template?.enabled) return false;

  const delayHours = template.delayHours ?? 1;
  const runAt = new Date(new Date(from).getTime() + delayHours * 3600_000);

  await enqueue({
    shop,
    type: "ABANDONED_CART_FOLLOWUP",
    priority: FOLLOWUP_PRIORITY,
    runAt,
    // Idempotent per checkout per step — a redelivered webhook cannot schedule
    // the same reminder twice.
    dedupeKey: `${shop}:AC:${checkoutId}:${step}`,
    payload: { shop, checkoutId, step },
  });

  return true;
}

/**
 * The follow-up job.
 *
 * Re-checks everything at send time. Between scheduling and firing, the customer
 * may have ordered, opted out, or simply come back and carried on editing.
 */
export async function runAbandonedFollowUp({ shop, checkoutId, step, force = false }) {
  const checkout = await db.abandonedCheckout.findUnique({
    where: { id: checkoutId },
  });

  if (!checkout || checkout.shop !== shop) return { sent: false, reason: "Not found" };

  // Never overridable, not even by the merchant pressing Send: the customer has
  // paid, and a "you left something behind" text would be nonsense.
  if (checkout.status === "RECOVERED") {
    return { sent: false, reason: "The customer completed their order" };
  }

  // A forced send is the merchant deciding, by hand, on one specific customer.
  // The automation's own gates — the feature switch, the per-step switch, the
  // delay — are there to stop the app acting on its own, and none of them is a
  // reason to refuse a person who is pressing the button.
  if (!force) {
    if (checkout.status === "SKIPPED" || checkout.status === "EXPIRED") {
      return { sent: false, reason: `Checkout is ${checkout.status.toLowerCase()}` };
    }
  }

  const settings = await getSettings(shop);

  if (!force && !settings.abandonedCartEnabled) {
    return { sent: false, reason: "Abandoned cart recovery is off" };
  }

  const template = await getTemplate(shop, FOLLOW_UP_KEYS[step]);

  if (!template) {
    return { sent: false, reason: `Follow-up ${step + 1} does not exist` };
  }

  if (!force && !template.enabled) {
    return { sent: false, reason: `Follow-up ${step + 1} is disabled` };
  }

  // The customer was still active after this job was scheduled — they came back
  // and kept editing. Push the reminder out rather than interrupting them.
  const dueAt = new Date(
    checkout.abandonedAt.getTime() + (template.delayHours ?? 1) * 3600_000,
  );

  if (!force && dueAt > new Date()) {
    return { sent: false, rescheduleTo: dueAt, reason: "The customer is still active" };
  }

  if (!checkout.recoveryUrl) {
    return { sent: false, reason: "Shopify gave no recovery URL for this checkout" };
  }

  const rendered = renderMessage(template.body, {
    customer_name: checkout.customerName ?? "Customer",
    cart_total: formatMoney(checkout.cartValue, checkout.currency),
    recovery_url: checkout.recoveryUrl,
    shop_name: settings.shopName ?? shop.replace(/\.myshopify\.com$/, ""),
    // Only if the merchant switched the discount on AND put it in this message.
    discount_code:
      settings.discountEnabled && template.includeDiscount
        ? (settings.discountCode ?? "")
        : "",
  });

  if (rendered.blocked) {
    return { sent: false, reason: rendered.reason };
  }

  const result = await sendSms({
    shop,
    phone: checkout.phone,
    message: rendered.text,
    type: "ABANDONED_CART",
    dedupeKey: `ABANDONED_CART:${checkout.id}:${step}`,
    customerName: checkout.customerName,
    customerId: checkout.customerId,
    smsConsent: checkout.smsConsent,
  });

  if (result.outcome === "DEFERRED") {
    return { sent: false, rescheduleTo: result.runAt, reason: result.reason };
  }

  const sent = result.outcome === "SENT" || result.outcome === "DUPLICATE";

  // DUPLICATE means this exact reminder already went out — the merchant sent it
  // early by hand, and the scheduled job has now come round to the same
  // dedupeKey. The customer got one message, so the count must go up by one, not
  // two. It still counts as `sent` above, so the sequence chains on to the next
  // follow-up rather than stalling here.
  const charged = result.outcome === "SENT";

  await db.abandonedCheckout.update({
    where: { id: checkout.id },
    data: {
      status: sent ? "SENT" : checkout.status,
      followUpsSent: charged ? { increment: 1 } : undefined,
      lastFollowUpAt: charged ? new Date() : undefined,
    },
  });

  // Chain the next reminder, timed from ABANDONMENT — not from this send.
  //
  // The settings say "24 hours after abandoning", so that is what it must mean.
  // Timing it from the previous send instead would make follow-up 2 land 24h
  // after follow-up 1 (i.e. 25h after abandoning) and drift further with each
  // step — and the send-time guard, which checks abandonedAt + delay, would then
  // refuse to send the message it had just scheduled.
  const nextStep = step + 1;

  if (sent && nextStep < FOLLOW_UP_KEYS.length) {
    const scheduled = await scheduleFollowUp(
      shop,
      checkout.id,
      nextStep,
      checkout.abandonedAt,
    );

    if (!scheduled) {
      await db.abandonedCheckout.update({
        where: { id: checkout.id },
        data: { status: "EXPIRED" },
      });
    }
  } else if (sent) {
    // Last reminder sent and no order — the sequence is done.
    await db.abandonedCheckout.update({
      where: { id: checkout.id },
      data: { status: "EXPIRED" },
    });
  }

  return { sent, reason: result.reason };
}

/**
 * An order arrived. If it came from a checkout we were chasing, stop chasing it.
 *
 * Matched on Shopify's checkout token, which the order carries — not on phone or
 * email, which would wrongly mark a *different* cart as recovered when a customer
 * abandons one checkout and separately orders something else.
 */
export async function markRecoveredByOrder({ shop, order }) {
  const token = order?.checkout_token ?? order?.checkout_id;

  if (!token) return { recovered: false };

  const updated = await db.abandonedCheckout.updateMany({
    where: {
      shop,
      checkoutToken: String(token),
      // Anything that is not already recovered. EXPIRED must be included: it only
      // means the reminder sequence finished, not that the cart is dead — and a
      // customer who buys a day after the last nudge is exactly the recovery this
      // feature exists to produce. Excluding it would undercount the wins.
      status: { not: "RECOVERED" },
    },
    data: {
      status: "RECOVERED",
      recoveredAt: new Date(),
      orderId: String(order.admin_graphql_api_id ?? order.id),
    },
  });

  return { recovered: updated.count > 0 };
}

/**
 * The merchant pressed "Send SMS" on one checkout.
 *
 * This fires the NEXT reminder in the sequence early rather than inventing a
 * separate one-off message, and it deliberately reuses that step's dedupeKey. So
 * when the scheduled job for the same step comes round later it finds the SmsLog
 * row already there, returns DUPLICATE, sends nothing, and chains follow-up 2 as
 * if it had sent it — the customer gets one message, not two.
 */
export async function sendManualFollowUp({ shop, checkoutId }) {
  const checkout = await db.abandonedCheckout.findUnique({
    where: { id: checkoutId },
  });

  if (!checkout || checkout.shop !== shop) {
    return { sent: false, reason: "This checkout no longer exists" };
  }

  const step = checkout.followUpsSent;

  if (step >= FOLLOW_UP_KEYS.length) {
    return {
      sent: false,
      reason: "All three reminders have already been sent to this customer",
    };
  }

  // Consent is NOT overridable here. Everything else about a manual send is the
  // merchant's call; whether the customer agreed to be marketed to is not.
  if (!checkout.smsConsent) {
    return { sent: false, reason: "This customer did not accept SMS marketing" };
  }

  return runAbandonedFollowUp({ shop, checkoutId, step, force: true });
}

/**
 * The checkout list, with the moment each one is next due.
 *
 * The due time is derived, not stored: it is abandonedAt + the delay on the step
 * we are up to. Storing it would go stale every time the customer touches their
 * checkout again and pushes abandonedAt forward.
 */
export async function listCheckouts(shop, take = 50) {
  const [checkouts, templates] = await Promise.all([
    db.abandonedCheckout.findMany({
      where: { shop },
      orderBy: { abandonedAt: "desc" },
      take,
    }),
    db.messageTemplate.findMany({ where: { shop, key: { in: FOLLOW_UP_KEYS } } }),
  ]);

  const byKey = Object.fromEntries(templates.map((template) => [template.key, template]));

  return checkouts.map((checkout) => {
    const next = byKey[FOLLOW_UP_KEYS[checkout.followUpsSent]];

    const pending =
      checkout.status === "WAITING" || checkout.status === "SENT";

    const nextDueAt =
      pending && next?.enabled
        ? new Date(
            checkout.abandonedAt.getTime() + (next.delayHours ?? 1) * 3600_000,
          )
        : null;

    return {
      id: checkout.id,
      customerName: checkout.customerName ?? "Customer",
      phone: checkout.phone ?? "No phone number",
      cartValue: Number(checkout.cartValue),
      currency: checkout.currency,
      status: checkout.status,
      smsConsent: checkout.smsConsent,
      followUpsSent: checkout.followUpsSent,
      recovered: checkout.status === "RECOVERED",
      abandonedAt: checkout.abandonedAt.toISOString(),
      nextDueAt: nextDueAt?.toISOString() ?? null,
      // Why this row cannot be messaged, if it cannot. The merchant asking "why
      // did this customer get nothing" should not have to guess.
      blockedReason: !checkout.phone
        ? "No usable phone number"
        : !checkout.smsConsent
          ? "Did not accept SMS marketing"
          : checkout.status === "RECOVERED"
            ? "Already ordered"
            : checkout.followUpsSent >= FOLLOW_UP_KEYS.length
              ? "All reminders sent"
              : null,
    };
  });
}

/** Recovery stats for the abandoned cart page. */
export async function abandonedStats(shop) {
  const [sent, recovered, revenueAgg] = await Promise.all([
    db.smsLog.count({
      where: { shop, type: "ABANDONED_CART", status: { in: ["SENT", "DELIVERED"] } },
    }),
    db.abandonedCheckout.count({
      where: { shop, status: "RECOVERED", followUpsSent: { gt: 0 } },
    }),
    db.abandonedCheckout.aggregate({
      where: { shop, status: "RECOVERED", followUpsSent: { gt: 0 } },
      _sum: { cartValue: true },
    }),
  ]);

  return {
    sent,
    // Only carts we actually messaged count as recovered BY US. A customer who
    // came back on their own is not a recovery this app can claim.
    recovered,
    revenue: Number(revenueAgg._sum.cartValue ?? 0),
  };
}
