import db from "../../db.server.js";
import { reconcileBilling } from "./shopify.server.js";

// Billing webhooks: app_subscriptions/update and app_purchases_one_time/update.
//
// Without these, the app only learns about a payment when the merchant happens to
// open the Billing page. That is wrong in both directions:
//
//   - A merchant approves a charge and closes the tab. They have paid, and we owe
//     them the credits now — not whenever they next visit.
//   - A subscription fails to renew, or the merchant cancels it from the Shopify
//     admin. We would go on believing they are subscribed, and go on sending.
//
// THE WEBHOOK IS A TRIGGER, NOT THE TRUTH. It tells us something changed; we then
// ASK SHOPIFY what is actually true and settle up from that answer. That is a
// deliberate choice: it reuses the one credit-granting path (which is idempotent
// and already tested), it survives Shopify changing the payload shape, and it
// means a payload we misread cannot mint credits — the worst it can do is trigger
// a reconcile that finds nothing.

/** Pull the charge out of either payload shape, for logging. */
function describeCharge(payload) {
  const charge = payload?.app_subscription ?? payload?.app_purchase_one_time ?? {};

  return {
    id: charge.admin_graphql_api_id ?? charge.id ?? "unknown",
    name: charge.name ?? "unknown",
    status: charge.status ?? "unknown",
  };
}

export async function onBillingUpdate({ shop, admin, payload, topic }) {
  const charge = describeCharge(payload);

  console.log(
    `[billing webhook] ${topic} for ${shop}: ${charge.name} (${charge.id}) is ${charge.status}`,
  );

  // No admin client means no session — the app has been uninstalled, and this is
  // a final webhook arriving after the fact. There is nobody left to credit.
  if (!admin) {
    return { acted: false, reason: "No session for this shop (uninstalled?)" };
  }

  // The shop must exist locally before we can credit it. A billing webhook for a
  // shop we have never seen is not something to create a settings row for.
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (!settings) {
    return { acted: false, reason: "This shop has no settings row" };
  }

  const result = await reconcileBilling(admin, shop);

  return {
    acted: result.granted > 0 || result.subscriptionActive !== settings.subscriptionActive,
    reason:
      result.granted > 0
        ? `granted ${result.granted} credits`
        : `subscription active: ${result.subscriptionActive}`,
  };
}
