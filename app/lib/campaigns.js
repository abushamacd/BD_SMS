// Campaign display constants. Isomorphic — the campaign pages render these, so
// they must not live in a *.server module.

export const STATUS_TONE = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  SENDING: "accent",
  PAUSED: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
  FAILED: "critical",
};

export const STATUS_LABEL = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Could not run",
};

export const RECIPIENT_TONE = {
  QUEUED: "neutral",
  SENT: "info",
  DELIVERED: "success",
  FAILED: "critical",
  SKIPPED: "warning",
};

export const SEGMENTS = [
  {
    value: "consented",
    label: "All customers who accepted SMS marketing",
    details: "The safe default. Everyone who opted in.",
  },
  {
    value: "tag",
    label: "By customer tag",
    details: "Target a segment you already maintain in Shopify.",
  },
  {
    value: "orders",
    label: "By number of orders",
    details: "Reward repeat buyers, or win back one-time customers.",
  },
  {
    value: "recency",
    label: "By last order date",
    details: "Reach customers who have not bought in a while.",
  },
];

export const RECENCY_OPTIONS = [
  { value: "30", label: "No order in the last 30 days" },
  { value: "60", label: "No order in the last 60 days" },
  { value: "90", label: "No order in the last 90 days" },
  { value: "180", label: "No order in the last 180 days" },
];

export const ORDER_OPTIONS = [
  { value: "1", label: "1 or more orders" },
  { value: "3", label: "3 or more orders" },
  { value: "5", label: "5 or more orders" },
  { value: "10", label: "10 or more orders" },
];

/** Human description of a stored segment, for the list and detail pages. */
export function describeSegment(segment) {
  switch (segment?.type) {
    case "tag":
      return `Tag: ${segment.value}`;
    case "orders":
      return `${segment.value}+ orders`;
    case "recency":
      return `No order in the last ${segment.value} days`;
    default:
      return "All SMS-consented customers";
  }
}
