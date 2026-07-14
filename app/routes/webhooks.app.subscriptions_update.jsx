import { onBillingUpdate } from "../lib/billing/webhook.server";
import { handleShopifyWebhook } from "../lib/webhooks/handle.server";

export const action = async ({ request }) =>
  handleShopifyWebhook(request, onBillingUpdate);
