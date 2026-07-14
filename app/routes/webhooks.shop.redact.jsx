import { onShopRedact } from "../lib/gdpr/redact.server";
import { handleShopifyWebhook } from "../lib/webhooks/handle.server";

export const action = async ({ request }) =>
  handleShopifyWebhook(request, onShopRedact);
