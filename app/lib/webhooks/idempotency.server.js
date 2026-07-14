import db from "../../db.server.js";

// Shopify guarantees at-least-once delivery, not exactly-once. The same
// orders/create can arrive twice — on a retry after a slow response, or during a
// Shopify-side replay — and each delivery carries the same X-Shopify-Webhook-Id.
//
// This is the first of two idempotency layers. The second is the unique
// dedupeKey on SmsLog, which catches duplicates this one cannot: a webhook
// *redelivered under a new id*, which Shopify does do. Neither layer alone is
// enough, and the cost of getting it wrong is texting a customer twice and
// billing the merchant twice.

/**
 * @returns {Promise<boolean>} true if this is the first time we have seen this
 *   webhook, false if it is a repeat and should be ignored.
 */
export async function claimWebhook(webhookId, shop, topic) {
  if (!webhookId) return true; // no id to dedupe on; SmsLog.dedupeKey still guards us

  try {
    await db.processedWebhook.create({
      data: { id: webhookId, shop, topic },
    });
    return true;
  } catch (error) {
    if (error.code === "P2002") return false; // already processed
    throw error;
  }
}
