import { onOrderCreated } from "../lib/orders/automations.server";
import { handleOrderWebhook } from "../lib/webhooks/handle.server";

export const action = async ({ request }) =>
  handleOrderWebhook(request, ({ shop, admin, payload }) =>
    onOrderCreated({ shop, admin, order: payload }),
  );
