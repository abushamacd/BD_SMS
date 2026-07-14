// Template variables: what each automation may use, and what happens when a
// variable has no value.
//
// Two failures this prevents, both of which reach the customer:
//
//   1. A typo. `renderTemplate` leaves an unknown {{customer_naem}} untouched,
//      so the customer receives the literal text "Hi {{customer_naem}}". The
//      merchant sees nothing wrong in the editor. Templates are therefore
//      validated on save, and any stray placeholder is stripped at send time.
//
//   2. An empty value. A fulfillment with no tracking number renders
//      "Track it here: " — a message that cost a credit and says nothing.
//      Variables whose entire purpose is to carry a link or a code BLOCK the
//      send when empty; cosmetic ones fall back or are removed.

/** Empty is fatal: the message is pointless without it. */
const BLOCK_IF_EMPTY = new Set([
  "tracking_url",
  "recovery_url",
  "otp_code",
  "confirm_url",
  "discount_code",
]);

/** Empty is survivable: use this instead. */
const FALLBACKS = {
  customer_name: "Customer",
};

export const TEMPLATE_VARIABLES = {
  NEW_ORDER: ["customer_name", "order_number", "order_total", "shop_name"],
  FULFILLMENT: ["customer_name", "order_number", "shop_name"],
  SHIPMENT: [
    "customer_name",
    "order_number",
    "tracking_url",
    "tracking_number",
    "shop_name",
  ],
  DELIVERY: ["customer_name", "order_number", "shop_name"],
  CANCELLED: ["customer_name", "order_number", "shop_name"],
  COD_OTP: [
    "customer_name",
    "order_number",
    "order_total",
    "otp_code",
    "confirm_url",
    "shop_name",
  ],
  ABANDONED_CART_1: ["customer_name", "cart_total", "recovery_url", "shop_name"],
  ABANDONED_CART_2: [
    "customer_name",
    "cart_total",
    "recovery_url",
    "discount_code",
    "shop_name",
  ],
  ABANDONED_CART_3: [
    "customer_name",
    "cart_total",
    "recovery_url",
    "discount_code",
    "shop_name",
  ],
  CAMPAIGN: ["customer_name", "shop_name"],
};

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** Every {{variable}} used in a template body. */
export function variablesUsed(body = "") {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

/**
 * Check a template before it is saved. This is where a typo should be caught —
 * in the editor, not in a customer's inbox.
 *
 * @returns {{ok: boolean, errors: string[], unknown: string[]}}
 */
export function validateTemplate(key, body) {
  const allowed = TEMPLATE_VARIABLES[key] ?? [];
  const used = variablesUsed(body);
  const unknown = used.filter((name) => !allowed.includes(name));

  const errors = [];

  if (!body?.trim()) {
    errors.push("The message cannot be empty.");
  }

  for (const name of unknown) {
    errors.push(
      `{{${name}}} is not available here. You can use: ${allowed.map((v) => `{{${v}}}`).join(", ")}`,
    );
  }

  return { ok: errors.length === 0, errors, unknown };
}

/**
 * Tidy the text left behind when a variable is removed: doubled spaces, a
 * dangling "Track it here:" colon, a trailing dash from "- {{shop_name}}".
 */
function tidy(text) {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?])/g, "$1")
    .replace(/[:\-–]\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Render a template for sending.
 *
 * @returns {{text: string, blocked: boolean, reason: string|null, missing: string[]}}
 *   `blocked` means do not send — the message would be incomplete.
 */
export function renderMessage(body = "", values = {}) {
  const used = variablesUsed(body);
  const missing = [];

  for (const name of used) {
    const value = values[name];
    const isEmpty = value === undefined || value === null || String(value).trim() === "";

    if (isEmpty) missing.push(name);
  }

  // A missing link or code makes the message useless. Better to send nothing and
  // say why than to spend a credit on "Track it here:".
  const fatal = missing.filter((name) => BLOCK_IF_EMPTY.has(name));

  if (fatal.length > 0) {
    return {
      text: "",
      blocked: true,
      reason: `No value for ${fatal.map((name) => `{{${name}}}`).join(", ")}`,
      missing,
    };
  }

  const text = tidy(
    body.replace(PLACEHOLDER, (match, name) => {
      if (Object.prototype.hasOwnProperty.call(values, name)) {
        const value = String(values[name] ?? "").trim();
        return value || FALLBACKS[name] || "";
      }

      // Unknown variable — a typo the merchant never noticed. Strip it. Sending
      // "{{customer_naem}}" to a customer is worse than sending nothing there.
      return "";
    }),
  );

  return { text, blocked: false, reason: null, missing };
}
