// Protected customer data.
//
// A customer's phone number and name are Level 2 protected data. Shopify refuses
// every query that touches the Customer object until the app is approved for it,
// with:
//
//   "This app is not approved to access the Customer object."
//
// That is not a bug we can fix in code — it is an access request the app owner
// files in the Partner Dashboard. What we CAN fix is what the merchant sees: an
// unhandled GraphQL error blows up the whole page and tells them nothing they can
// act on. So every path that reads customer data detects this one error and turns
// it into an explanation.
//
// Isomorphic: the pages render the message, the server produces it.

export const PROTECTED_DATA_HELP_URL =
  "https://shopify.dev/docs/apps/launch/protected-customer-data";

export const PROTECTED_DATA_HEADING =
  "This app is not approved to read customer data yet";

export const PROTECTED_DATA_MESSAGE =
  "Shopify is refusing to return customer names and phone numbers. Approve protected customer data access for this app in the Partner Dashboard: Apps → BD SMS → API access → Protected customer data access. Request the Phone and Name fields. On a development store access is granted as soon as you complete the form; a live store needs Shopify's review.";

/**
 * Is this failure Shopify refusing us protected customer data?
 *
 * Matched on the response rather than a status code, because Shopify returns this
 * as a 200 with an errors array — it is an authorisation decision, not a
 * transport failure, and it must not be retried.
 */
export function isProtectedDataError(error) {
  const haystack =
    typeof error === "string"
      ? error
      : `${error?.message ?? ""} ${safeStringify(error?.body ?? error?.response ?? error)}`;

  return (
    /not approved to access the Customer object/i.test(haystack) ||
    /protected customer data/i.test(haystack) ||
    /ACCESS_DENIED/.test(haystack)
  );
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** Thrown by the server; caught by the loader that wants to explain it. */
export class ProtectedDataError extends Error {
  constructor() {
    super(PROTECTED_DATA_MESSAGE);
    this.name = "ProtectedDataError";
    this.protectedData = true;
  }
}
