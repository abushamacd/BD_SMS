import { normalizeBdPhone } from "../phone.js";
import { ProtectedDataError, isProtectedDataError } from "../protected-data.js";

// Building a campaign audience.
//
// Shopify's customer search has NO filter for SMS marketing consent — it can
// filter by tag, orders_count and order_date, but marketingState is only a field
// on the response, never a query term. So consent is filtered here, in our code,
// after fetching. That is not an optimisation we skipped; it is the only way.
//
// Everything else that can be pushed into the Shopify query is, because pulling
// 50,000 customers to filter five of them out locally is how you get rate
// limited.

// A campaign larger than this is almost certainly a mistake, and pulling it would
// take thousands of API calls. We stop and say so rather than silently truncate.
const MAX_AUDIENCE = 50_000;
const PAGE_SIZE = 250; // Shopify's maximum

const CUSTOMERS_QUERY = `#graphql
  query CampaignAudience($first: Int!, $after: String, $query: String) {
    customers(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        firstName
        lastName
        phone
        numberOfOrders
        smsMarketingConsent { marketingState }
        lastOrder { createdAt }
      }
    }
  }
`;

/** Turn a segment into the part of the filter Shopify itself can do. */
export function buildShopifyQuery(segment) {
  switch (segment?.type) {
    case "tag":
      return segment.value ? `tag:'${String(segment.value).replace(/'/g, "")}'` : "";
    case "orders":
      return `orders_count:>=${Number(segment.value) || 1}`;
    default:
      // "consented" and "recency" have no server-side equivalent — consent is not
      // a searchable field, and "has NOT ordered since X" cannot be expressed as
      // a positive date filter. Both are applied below.
      return "";
  }
}

/** The filters Shopify cannot do. */
function passesLocalFilters(customer, segment) {
  // Every campaign is marketing, so this is not optional and not overridable.
  if (customer.smsMarketingConsent?.marketingState !== "SUBSCRIBED") return false;

  if (segment?.type === "recency") {
    const days = Number(segment.value) || 90;
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    const last = customer.lastOrder?.createdAt
      ? new Date(customer.lastOrder.createdAt).getTime()
      : 0;

    // "No order in the last N days" — a customer who has never ordered qualifies.
    if (last > cutoff) return false;
  }

  return true;
}

/**
 * Fetch everyone who should receive this campaign.
 *
 * Numbers are normalised and deduplicated here: two customer records with the
 * same phone written differently are one person and must be charged once.
 *
 * @returns {Promise<{recipients: Array, scanned: number, truncated: boolean,
 *   skippedNoConsent: number, skippedBadPhone: number}>}
 */
export async function buildAudience(admin, segment) {
  const query = buildShopifyQuery(segment);

  const recipients = [];
  const seen = new Set();

  let scanned = 0;
  let skippedNoConsent = 0;
  let skippedBadPhone = 0;
  let after = null;
  let truncated = false;

  for (;;) {
    let body;

    try {
      const response = await admin.graphql(CUSTOMERS_QUERY, {
        variables: { first: PAGE_SIZE, after, query: query || null },
      });

      body = await response.json();
    } catch (error) {
      if (isProtectedDataError(error)) throw new ProtectedDataError();
      throw error;
    }

    const page = body?.data?.customers;

    if (!page) {
      // Not a broken query — an ungranted permission. Worth distinguishing,
      // because a campaign that fails here must not be retried: no number of
      // retries will grant the app access to customer data.
      if (isProtectedDataError(body?.errors)) throw new ProtectedDataError();

      throw new Error(
        `Could not load customers: ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`,
      );
    }

    for (const customer of page.nodes) {
      scanned += 1;

      if (!passesLocalFilters(customer, segment)) {
        skippedNoConsent += 1;
        continue;
      }

      const phone = normalizeBdPhone(customer.phone);

      if (!phone.valid) {
        skippedBadPhone += 1;
        continue;
      }

      if (seen.has(phone.e164)) continue;
      seen.add(phone.e164);

      recipients.push({
        phone: phone.e164,
        customerId: customer.id,
        customerName:
          `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Customer",
      });

      if (recipients.length >= MAX_AUDIENCE) {
        truncated = true;
        break;
      }
    }

    if (truncated || !page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  return { recipients, scanned, truncated, skippedNoConsent, skippedBadPhone };
}

export { MAX_AUDIENCE };
