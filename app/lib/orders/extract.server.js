// Pulling the fields we need out of Shopify's webhook payloads.
//
// Webhook bodies are the REST shape (snake_case), not GraphQL, regardless of the
// API version. The fields we need are scattered and frequently null, so this is
// the one place that knows where to look.

/**
 * Find the customer's phone number.
 *
 * Order of preference matters. The shipping address phone is the number the
 * courier will actually call, and for a COD order in Bangladesh that is the
 * number that matters — a customer often orders on one number and receives on
 * another. The account phone is the fallback.
 */
export function extractPhone(order) {
  return (
    order?.shipping_address?.phone ||
    order?.customer?.phone ||
    order?.phone ||
    order?.billing_address?.phone ||
    null
  );
}

export function extractCustomerName(order) {
  const customer = order?.customer;
  const address = order?.shipping_address ?? order?.billing_address;

  const first = customer?.first_name || address?.first_name || "";
  const last = customer?.last_name || address?.last_name || "";
  const full = `${first} ${last}`.trim();

  return full || address?.name || "Customer";
}

/** Shopify's marketing consent, which campaigns and cart recovery must respect. */
export function extractSmsConsent(order) {
  const state =
    order?.customer?.sms_marketing_consent?.state ??
    order?.sms_marketing_consent?.state;

  return state === "subscribed";
}

/**
 * Is this cash on delivery?
 *
 * There is no boolean for this. COD shows up as an unpaid order whose payment
 * gateway is named something like "Cash on Delivery (COD)" — and the exact name
 * is chosen by the merchant, so it is matched loosely and confirmed by the
 * financial status. Getting a false positive here means texting an OTP to a
 * customer who already paid.
 */
export function isCashOnDelivery(order) {
  const names = [
    ...(order?.payment_gateway_names ?? []),
    order?.gateway ?? "",
  ].map((name) => String(name).toLowerCase());

  const looksLikeCod = names.some(
    (name) =>
      name.includes("cash on delivery") ||
      name.includes("cash_on_delivery") ||
      name === "cod" ||
      name.includes("(cod)") ||
      name.includes("manual"), // Shopify's built-in COD is a "manual" gateway
  );

  // A paid order is not awaiting cash on delivery, whatever the gateway says.
  const unpaid = ["pending", "unpaid", null, undefined].includes(
    order?.financial_status,
  );

  return looksLikeCod && unpaid;
}

/** "#1042" → "1042". Merchants write "#{{order_number}}" in their templates. */
export function extractOrderNumber(order) {
  if (order?.order_number != null) return String(order.order_number);
  return String(order?.name ?? "").replace(/^#/, "");
}

export function formatMoney(amount, currency = "BDT") {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";

  // Deliberately "1,250 BDT" and not "৳1,250": the Taka sign is not in the GSM-7
  // alphabet, so putting it in a message would force the whole SMS to Unicode
  // and halve its capacity from 160 characters to 70 — doubling the cost of
  // every order notification for a symbol nobody needs.
  // Whole amounts drop the decimals ("1,250 BDT"), but a price with paisa keeps
  // both digits — "1,250.5 BDT" is not a price anyone writes.
  const hasFraction = value % 1 !== 0;

  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(value);

  return `${formatted} ${currency}`;
}

/** Tracking URL from a fulfillment, if the merchant supplied one. */
export function extractTracking(fulfillment) {
  const url =
    fulfillment?.tracking_urls?.[0] || fulfillment?.tracking_url || null;

  return {
    url,
    number: fulfillment?.tracking_numbers?.[0] ?? fulfillment?.tracking_number ?? null,
    company: fulfillment?.tracking_company ?? null,
  };
}

/**
 * The variables available to a message template for an order.
 * Anything a merchant can type in {{...}} must be produced here.
 */
export function orderVariables(order, { shopName, tracking } = {}) {
  return {
    customer_name: extractCustomerName(order),
    order_number: extractOrderNumber(order),
    order_total: formatMoney(order?.total_price, order?.currency ?? "BDT"),
    shop_name: shopName ?? "",
    tracking_url: tracking?.url ?? "",
    tracking_number: tracking?.number ?? "",
  };
}
