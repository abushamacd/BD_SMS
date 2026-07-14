import { authenticate } from "../../shopify.server";
import { claimWebhook } from "./idempotency.server.js";

/**
 * The shape every order webhook route shares.
 *
 * Two rules are non-negotiable here:
 *
 *  - ALWAYS RETURN 200. Shopify retries any non-2xx, and a retry of a webhook we
 *    already acted on is a second SMS and a second charge. If our own code
 *    throws, that is our bug to fix from the logs — not something to have
 *    Shopify hammer us about while double-texting customers.
 *  - RETURN FAST. Shopify times out at 5 seconds. The handler only renders and
 *    enqueues; the worker does the sending.
 */
export async function handleOrderWebhook(request, handler) {
  const { shop, topic, payload, admin, webhookId } =
    await authenticate.webhook(request);

  try {
    const fresh = await claimWebhook(webhookId, shop, topic);

    if (!fresh) {
      console.log(`[webhook] ${topic} ${webhookId} already processed — ignoring`);
      return new Response();
    }

    const result = await handler({ shop, admin, payload });

    const acted = result?.queued || result?.scheduled || result?.recovered;

    console.log(
      `[webhook] ${topic} for ${shop}: ${
        acted ? "actioned" : `no action (${result?.reason ?? "nothing to do"})`
      }`,
    );
  } catch (error) {
    console.error(`[webhook] ${topic} for ${shop} failed:`, error);
  }

  return new Response();
}
