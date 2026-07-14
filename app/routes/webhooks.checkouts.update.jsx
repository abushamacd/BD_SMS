import { onCheckoutUpserted } from "../lib/checkouts/abandoned.server";
import { handleOrderWebhook } from "../lib/webhooks/handle.server";

export const action = async ({ request }) =>
  handleOrderWebhook(request, ({ shop, payload }) =>
    onCheckoutUpserted({ shop, checkout: payload }),
  );
