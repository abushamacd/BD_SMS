import { randomUUID } from "node:crypto";
import { MAX_RECIPIENTS } from "../manual.js";
import { enqueue } from "../queue/queue.server.js";
import { getSettings } from "../settings.server.js";
import { segmentSms } from "../sms-credits.js";

// A manual send from the Send SMS page.
//
// The messages go on the queue rather than being sent inline. A merchant texting
// 200 people cannot be made to sit on a loading spinner through 200 gateway calls
// — and if their browser gives up halfway, we must not be left having sent half
// the batch with nothing recording that we did.

// Below transactional messages. A manual blast must not delay someone's OTP.
const MANUAL_PRIORITY = -8;

/**
 * @param {object} params
 * @param {Array<{phone: string, name?: string, customerId?: string, smsConsent?: boolean}>} params.recipients
 * @param {boolean} params.consentOverride  The merchant confirmed they have permission.
 */
export async function sendManual({ shop, recipients, message, consentOverride = false }) {
  const text = String(message ?? "").trim();

  if (!text) return { ok: false, reason: "The message is empty." };
  if (recipients.length === 0) return { ok: false, reason: "No recipients." };

  if (recipients.length > MAX_RECIPIENTS) {
    return {
      ok: false,
      reason: `You can send to at most ${MAX_RECIPIENTS} people at once from here. For a bigger send, create a campaign — it gives you progress, pause and resume.`,
    };
  }

  const settings = await getSettings(shop);
  const segment = segmentSms(text);
  const total = segment.credits * recipients.length;

  // Checked up front so the merchant is told before anything is sent, rather
  // than finding out from 40 SKIPPED rows in the log. sendSms debits atomically
  // per message, so this is a courtesy — not the thing that prevents an
  // overdraft.
  if (settings.gatewayMode === "DEFAULT" && settings.creditBalance < total) {
    return {
      ok: false,
      reason: `This send costs ${total.toLocaleString()} credits and you have ${settings.creditBalance.toLocaleString()}.`,
      credits: total,
      balance: settings.creditBalance,
    };
  }

  const batchId = randomUUID().slice(0, 8);

  // Deduplicated by phone: the same person selected as a customer and pasted in
  // by hand is one person, and must be texted once.
  const seen = new Set();
  let queued = 0;

  for (const recipient of recipients) {
    if (seen.has(recipient.phone)) continue;
    seen.add(recipient.phone);

    await enqueue({
      shop,
      type: "SEND_SMS",
      priority: MANUAL_PRIORITY,
      // Scoped to this batch, so sending the same message to the same person
      // again tomorrow is allowed — but a double-submitted form is not.
      dedupeKey: `${shop}:MANUAL:${batchId}:${recipient.phone}`,
      payload: {
        shop,
        phone: recipient.phone,
        message: text,
        type: "MANUAL",
        dedupeKey: `MANUAL:${batchId}:${recipient.phone}`,
        customerName: recipient.name ?? null,
        customerId: recipient.customerId ?? null,
        smsConsent: Boolean(recipient.smsConsent),
        consentOverride,
      },
    });

    queued += 1;
  }

  return {
    ok: true,
    queued,
    credits: segment.credits * queued,
    duplicates: recipients.length - queued,
    batchId,
  };
}
