import { onFulfillmentUpdated } from "../lib/orders/automations.server";
import { handleOrderWebhook } from "../lib/webhooks/handle.server";

export const action = async ({ request }) =>
  handleOrderWebhook(request, ({ shop, admin, payload }) =>
    onFulfillmentUpdated({ shop, admin, fulfillment: payload }),
  );
