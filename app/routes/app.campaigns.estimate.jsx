import { authenticate } from "../shopify.server";
import { buildAudience } from "../lib/campaigns/audience.server";

// Resource route: how many customers would this segment actually reach?
//
// Deliberately NOT run on every keystroke — it pages through the Shopify customer
// API, so an automatic estimate on each edit would rate-limit the merchant's shop.
// The Create page calls it when the merchant asks for it.
export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  const form = await request.formData();
  const segment = {
    type: String(form.get("type") ?? "consented"),
    value: form.get("value") ? String(form.get("value")) : null,
  };

  try {
    const result = await buildAudience(admin, segment);

    return {
      ok: true,
      count: result.recipients.length,
      scanned: result.scanned,
      skippedNoConsent: result.skippedNoConsent,
      skippedBadPhone: result.skippedBadPhone,
      truncated: result.truncated,
      shop: session.shop,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};
