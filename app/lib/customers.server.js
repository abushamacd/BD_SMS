import { normalizeBdPhone } from "./phone.js";
import { ProtectedDataError, isProtectedDataError } from "./protected-data.js";

// Customer lookup for the Send SMS page.
//
// As in campaigns: Shopify's customer search has NO filter for SMS marketing
// consent. Tag and orders_count can be pushed into the query; consent is a field
// on the response and never a query term, so it is filtered here, after fetching.

const PAGE_SIZE = 100;

const SEARCH_QUERY = `#graphql
  query SendSmsCustomers($first: Int!, $query: String) {
    customers(first: $first, query: $query) {
      nodes {
        id
        firstName
        lastName
        phone
        tags
        numberOfOrders
        smsMarketingConsent { marketingState }
      }
    }
  }
`;

// Fetching the recipients again by id at send time, rather than trusting the
// phone numbers the browser posts back. The browser is not a source of truth for
// who gets texted.
const BY_IDS_QUERY = `#graphql
  query SendSmsRecipients($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Customer {
        id
        firstName
        lastName
        phone
        smsMarketingConsent { marketingState }
      }
    }
  }
`;

function toCustomer(node) {
  const phone = normalizeBdPhone(node.phone);

  return {
    id: node.id,
    name: `${node.firstName ?? ""} ${node.lastName ?? ""}`.trim() || "Customer",
    phone: phone.valid ? phone.e164 : null,
    rawPhone: node.phone ?? null,
    tags: node.tags ?? [],
    orders: node.numberOfOrders ? Number(node.numberOfOrders) : 0,
    smsConsent: node.smsMarketingConsent?.marketingState === "SUBSCRIBED",
  };
}

/** Everything Shopify itself can filter on, as a search query string. */
function buildQuery({ search, tag, minOrders }) {
  const parts = [];

  if (tag) parts.push(`tag:'${String(tag).replace(/'/g, "")}'`);
  if (Number(minOrders) > 0) parts.push(`orders_count:>=${Number(minOrders)}`);

  // Free text last. Quotes would be read as syntax, so they are stripped.
  const term = String(search ?? "").trim().replace(/["']/g, "");
  if (term) parts.push(term);

  return parts.join(" AND ");
}

export async function searchCustomers(admin, { search, tag, minOrders, consentOnly }) {
  const query = buildQuery({ search, tag, minOrders });

  let body;

  try {
    const response = await admin.graphql(SEARCH_QUERY, {
      variables: { first: PAGE_SIZE, query: query || null },
    });

    body = await response.json();
  } catch (error) {
    // Shopify may surface the refusal as a thrown GraphQL error rather than an
    // errors array, depending on how it rejects the request.
    if (isProtectedDataError(error)) throw new ProtectedDataError();
    throw error;
  }

  const nodes = body?.data?.customers?.nodes;

  if (!nodes) {
    // The common case in a new app: not a broken query, an ungranted permission.
    if (isProtectedDataError(body?.errors)) throw new ProtectedDataError();

    throw new Error(
      `Could not load customers: ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`,
    );
  }

  const all = nodes.map(toCustomer);

  // A customer with no usable number cannot be texted at all, so they are not
  // offered as a choice — but they are counted, because "why is this customer
  // missing from the list" needs an answer.
  const withPhone = all.filter((customer) => customer.phone);
  const noPhone = all.length - withPhone.length;

  const customers = consentOnly
    ? withPhone.filter((customer) => customer.smsConsent)
    : withPhone;

  return {
    customers,
    noPhone,
    noConsent: withPhone.length - withPhone.filter((c) => c.smsConsent).length,
    // The page shows the first PAGE_SIZE matches. Silently showing 100 of 4,000
    // and calling it "all customers" would be a lie.
    truncated: all.length >= PAGE_SIZE,
    pageSize: PAGE_SIZE,
  };
}

/** Re-fetch the chosen recipients at send time, by id. */
export async function fetchCustomersByIds(admin, ids) {
  if (ids.length === 0) return [];

  let body;

  try {
    const response = await admin.graphql(BY_IDS_QUERY, { variables: { ids } });
    body = await response.json();
  } catch (error) {
    if (isProtectedDataError(error)) throw new ProtectedDataError();
    throw error;
  }

  if (!body?.data?.nodes) {
    if (isProtectedDataError(body?.errors)) throw new ProtectedDataError();

    throw new Error(
      `Could not load the selected customers: ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`,
    );
  }

  return body.data.nodes
    .filter(Boolean)
    .map(toCustomer)
    .filter((customer) => customer.phone);
}
