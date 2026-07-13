import db from "../db.server.js";

// Defaults for a shop that has just installed the app. Every automation starts
// OFF: an app that begins texting a merchant's customers the moment it is
// installed, before they have seen a single template, is a support incident.
const DEFAULT_TEMPLATES = [
  {
    key: "NEW_ORDER",
    enabled: false,
    body: "Dear {{customer_name}}, your order #{{order_number}} of {{order_total}} has been received. Thank you for shopping with {{shop_name}}.",
  },
  {
    key: "FULFILLMENT",
    enabled: false,
    body: "Dear {{customer_name}}, your order #{{order_number}} is packed and ready to ship. - {{shop_name}}",
  },
  {
    key: "SHIPMENT",
    enabled: false,
    body: "Dear {{customer_name}}, order #{{order_number}} has been shipped. Track it here: {{tracking_url}} - {{shop_name}}",
  },
  {
    key: "DELIVERY",
    enabled: false,
    body: "Dear {{customer_name}}, order #{{order_number}} has been delivered. Thank you for shopping with {{shop_name}}.",
  },
  {
    key: "CANCELLED",
    enabled: false,
    body: "Dear {{customer_name}}, your order #{{order_number}} has been cancelled. Contact us if this was a mistake. - {{shop_name}}",
  },
  {
    key: "COD_OTP",
    enabled: false,
    body: "Your {{shop_name}} verification code is {{otp_code}}. Reply with this code to confirm order #{{order_number}}.",
  },
  {
    key: "ABANDONED_CART_1",
    enabled: false,
    delayHours: 1,
    includeDiscount: false,
    body: "Dear {{customer_name}}, you left {{cart_total}} in your cart at {{shop_name}}. Complete your order: {{recovery_url}}",
  },
  {
    key: "ABANDONED_CART_2",
    enabled: false,
    delayHours: 24,
    includeDiscount: true,
    body: "Still thinking it over, {{customer_name}}? Use code {{discount_code}} for a discount. Complete your order: {{recovery_url}}",
  },
  {
    key: "ABANDONED_CART_3",
    enabled: false,
    delayHours: 72,
    includeDiscount: true,
    body: "Last chance, {{customer_name}} - your cart expires soon. Use {{discount_code}} to save. {{recovery_url}}",
  },
];

/** Settings for a shop, creating them with safe defaults on first access. */
export async function getSettings(shop) {
  const existing = await db.shopSettings.findUnique({ where: { shop } });
  if (existing) return existing;

  return db.shopSettings.create({ data: { shop } });
}

/** Seed the default templates. Idempotent — safe to call on every install. */
export async function ensureTemplates(shop) {
  await Promise.all(
    DEFAULT_TEMPLATES.map((template) =>
      db.messageTemplate.upsert({
        where: { shop_key: { shop, key: template.key } },
        create: { shop, ...template },
        update: {}, // never overwrite a template the merchant has edited
      }),
    ),
  );
}

export async function getTemplate(shop, key) {
  return db.messageTemplate.findUnique({ where: { shop_key: { shop, key } } });
}

/**
 * Is `now` inside the shop's quiet hours?
 *
 * Handles the overnight case, which is the normal one: a window of 22:00 → 08:00
 * wraps past midnight, so a naive `start <= hour < end` comparison would report
 * quiet hours as *never* active.
 */
export function isQuietHours(settings, now = new Date()) {
  if (!settings.quietHoursEnabled) return false;

  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: settings.timezone || "Asia/Dhaka",
    }).format(now),
  );

  const { quietHoursStart: start, quietHoursEnd: end } = settings;

  if (start === end) return false;

  return start > end
    ? hour >= start || hour < end // wraps midnight (22 → 8)
    : hour >= start && hour < end; // same day (13 → 15)
}

/** The next moment quiet hours end, for deferring a held message. */
export function quietHoursEnd(settings, now = new Date()) {
  const end = settings.quietHoursEnd;
  const next = new Date(now);

  next.setHours(end, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  return next;
}
