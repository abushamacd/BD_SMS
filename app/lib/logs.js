// Log display constants. Isomorphic — the log page and dashboard render these,
// so they must not live in a *.server module (importing one from a component
// would pull Prisma into the browser bundle).

export const TYPES = [
  { value: "NEW_ORDER", label: "New order" },
  { value: "FULFILLMENT", label: "Fulfillment" },
  { value: "SHIPMENT", label: "Shipment" },
  { value: "DELIVERY", label: "Delivery" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "COD_OTP", label: "COD OTP" },
  { value: "ABANDONED_CART", label: "Abandoned cart" },
  { value: "CAMPAIGN", label: "Campaign" },
  { value: "MANUAL", label: "Manual" },
  { value: "TEST", label: "Test" },
  { value: "ALERT", label: "Low-balance alert" },
];

export const STATUSES = [
  { value: "QUEUED", label: "Queued" },
  { value: "SENT", label: "Sent" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "UNDELIVERED", label: "Not delivered" },
  { value: "FAILED", label: "Failed" },
  { value: "SKIPPED", label: "Skipped" },
];

export const STATUS_TONE = {
  QUEUED: "neutral",
  SENT: "info",
  DELIVERED: "success",
  // Charged but never arrived — a warning, not a hard error like a rejected send.
  UNDELIVERED: "warning",
  FAILED: "critical",
  SKIPPED: "warning",
};

export const TYPE_LABEL = Object.fromEntries(
  TYPES.map((type) => [type.value, type.label]),
);

export const PAGE_SIZE = 50;
