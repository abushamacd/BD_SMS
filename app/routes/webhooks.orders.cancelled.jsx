import { onOrderCancelled } from "../lib/orders/automations.server";
import { handleOrderWebhook } from "../lib/webhooks/handle.server";

export const action = async ({ request }) =>
  handleOrderWebhook(request, ({ shop, admin, payload }) =>
    onOrderCancelled({ shop, admin, order: payload }),
  );
