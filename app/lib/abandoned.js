// Abandoned-cart display constants. Isomorphic — the page renders these, so they
// must not live in a *.server module (importing one from a component would pull
// Prisma into the browser bundle).

import { ABANDONED_CART_KEYS, TEMPLATE_VARIABLES } from "./automations.js";

export { ABANDONED_CART_KEYS };

// The label says "after abandoning", not "after the last message", because that
// is what the backend does: every delay is measured from the moment the customer
// went quiet, so follow-up 3 at 72h means 72h after abandonment.
export const DELAY_OPTIONS = [
  { value: 1, label: "1 hour after abandoning" },
  { value: 3, label: "3 hours after abandoning" },
  { value: 6, label: "6 hours after abandoning" },
  { value: 12, label: "12 hours after abandoning" },
  { value: 24, label: "24 hours after abandoning" },
  { value: 48, label: "48 hours after abandoning" },
  { value: 72, label: "72 hours after abandoning" },
];

export const FOLLOW_UPS = ABANDONED_CART_KEYS.map((key, index) => ({
  key,
  index,
  name: `Follow-up ${index + 1}`,
  variables: TEMPLATE_VARIABLES[key],
}));

export const STATUS_TONE = {
  WAITING: "neutral",
  SENT: "info",
  RECOVERED: "success",
  EXPIRED: "neutral",
  SKIPPED: "warning",
};

export const STATUS_LABEL = {
  WAITING: "Waiting",
  SENT: "Reminder sent",
  RECOVERED: "Recovered",
  EXPIRED: "Sequence finished",
  SKIPPED: "Skipped",
};

export function delayLabel(hours) {
  return (
    DELAY_OPTIONS.find((option) => option.value === Number(hours))?.label ??
    `${hours} hours after abandoning`
  );
}
