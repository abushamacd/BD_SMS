import db from "../../db.server.js";
import { enqueue } from "../queue/queue.server.js";
import { getSettings, getTemplate } from "../settings.server.js";
import { renderMessage } from "../templates.server.js";
import { markRecoveredByOrder } from "../checkouts/abandoned.server.js";
import { startCodVerification } from "./cod-otp.server.js";
import {
  extractPhone,
  extractCustomerName,
  extractSmsConsent,
  extractTracking,
  isCashOnDelivery,
  orderVariables,
} from "./extract.server.js";

// Order automations.
//
// A webhook arrives, and this decides whether it becomes an SMS. Webhook
// handlers must return fast — Shopify times out at 5 seconds and retries, which
// would double-send — so nothing here talks to a gateway. It renders the message
// and puts a job on the queue; the worker does the slow part.

// Transactional order messages outrank campaigns in the queue. A customer
// waiting for their order confirmation should not sit behind 10,000 marketing
// messages.
const ORDER_PRIORITY = 5;

/** The shop's display name, fetched once and cached. */
async function getShopName(shop, admin) {
  const settings = await getSettings(shop);
  if (settings.shopName) return settings.shopName;

  // Fall back to the domain prefix if we cannot ask — better a slightly wrong
  // name in one SMS than a webhook that throws and gets retried forever.
  let name = shop.replace(/\.myshopify\.com$/, "");

  if (admin) {
    try {
      const response = await admin.graphql(`#graphql
        query ShopName { shop { name } }
      `);
      const body = await response.json();
      name = body?.data?.shop?.name || name;
    } catch {
      // keep the fallback
    }
  }

  await db.shopSettings.update({ where: { shop }, data: { shopName: name } });

  return name;
}

/**
 * Render a template and queue it. Returns why it was skipped, if it was — the
 * webhook routes log this, so a merchant asking "why no SMS" has an answer.
 */
async function queueOrderSms({
  shop,
  admin,
  order,
  templateKey,
  smsType,
  dedupeKey,
  extraVariables = {},
  tracking = null,
}) {
  const template = await getTemplate(shop, templateKey);

  // The merchant has this automation switched off. Nothing to do — and notably
  // no SmsLog row, because a message that was never meant to be sent is not a
  // skipped message.
  if (!template?.enabled) {
    return { queued: false, reason: `${templateKey} is disabled` };
  }

  const phone = extractPhone(order);

  if (!phone) {
    return { queued: false, reason: "The order has no phone number" };
  }

  const shopName = await getShopName(shop, admin);

  const rendered = renderMessage(template.body, {
    ...orderVariables(order, { shopName, tracking }),
    ...extraVariables,
  });

  // The template wanted a link or a code we do not have — a tracking URL the
  // merchant never entered, say. Sending "Track it here:" with nothing after it
  // costs a credit and tells the customer nothing.
  if (rendered.blocked) {
    return { queued: false, reason: rendered.reason };
  }

  const message = rendered.text;

  await enqueue({
    shop,
    type: "SEND_SMS",
    priority: ORDER_PRIORITY,
    // Globally unique, so a webhook redelivered under a *new* id still cannot
    // queue a second job for the same event.
    dedupeKey: `${shop}:${dedupeKey}`,
    payload: {
      shop,
      phone,
      message,
      type: smsType,
      dedupeKey, // SmsLog's own guard, scoped per shop by its unique index
      customerName: extractCustomerName(order),
      customerId: order?.customer?.id ? String(order.customer.id) : null,
      orderId: String(order?.admin_graphql_api_id ?? order?.id ?? ""),
      smsConsent: extractSmsConsent(order),
    },
  });

  return { queued: true };
}

/**
 * orders/create.
 *
 * A COD order gets two independent things: the ordinary "we got your order" SMS
 * (if enabled), and the OTP that confirms it is a real customer (if enabled).
 * They are separate features with separate toggles, so a merchant who only wants
 * COD verification is not forced to also pay for an order-confirmation SMS.
 */
export async function onOrderCreated({ shop, admin, order }) {
  const results = {};

  // First: if this order came from a checkout we were chasing, stop chasing it.
  // Done before anything else so a slow SMS path cannot let a reminder slip out
  // to someone who has just paid.
  results.recovered = await markRecoveredByOrder({ shop, order });

  results.newOrder = await queueOrderSms({
    shop,
    admin,
    order,
    templateKey: "NEW_ORDER",
    smsType: "NEW_ORDER",
    dedupeKey: `NEW_ORDER:${order.id}`,
  });

  if (isCashOnDelivery(order)) {
    results.codOtp = await startCodVerification({ shop, admin, order });
  }

  return {
    queued: Boolean(results.newOrder.queued || results.codOtp?.queued),
    recovered: results.recovered.recovered,
    reason: [
      results.recovered.recovered && "recovered an abandoned checkout",
      results.newOrder.reason && `new order: ${results.newOrder.reason}`,
      results.codOtp?.reason && `cod otp: ${results.codOtp.reason}`,
    ]
      .filter(Boolean)
      .join("; "),
    results,
  };
}

export async function onOrderCancelled({ shop, admin, order }) {
  return queueOrderSms({
    shop,
    admin,
    order,
    templateKey: "CANCELLED",
    smsType: "CANCELLED",
    dedupeKey: `CANCELLED:${order.id}`,
  });
}

/** orders/fulfilled — the whole order has been fulfilled. */
export async function onOrderFulfilled({ shop, admin, order }) {
  const tracking = extractTracking(order?.fulfillments?.[0]);

  return queueOrderSms({
    shop,
    admin,
    order,
    templateKey: "FULFILLMENT",
    smsType: "FULFILLMENT",
    dedupeKey: `FULFILLMENT:${order.id}`,
    tracking,
  });
}

/**
 * fulfillments/create — a shipment has been created.
 *
 * The fulfillment payload does not carry the customer, so the order is fetched.
 * Only sent when there is a tracking URL: a "your order has shipped, track it
 * here" SMS with no link is just the fulfillment message again, and the merchant
 * would be paying twice to say the same thing.
 */
export async function onFulfillmentCreated({ shop, admin, fulfillment }) {
  const tracking = extractTracking(fulfillment);

  if (!tracking.url && !tracking.number) {
    return { queued: false, reason: "The fulfillment has no tracking information" };
  }

  const order = await fetchOrder(admin, fulfillment.order_id, fulfillment);

  if (!order) {
    return { queued: false, reason: "Could not load the order for this fulfillment" };
  }

  return queueOrderSms({
    shop,
    admin,
    order,
    templateKey: "SHIPMENT",
    smsType: "SHIPMENT",
    dedupeKey: `SHIPMENT:${fulfillment.id}`,
    tracking,
  });
}

/**
 * fulfillments/update — fires on every change to a fulfillment. We only care
 * about one: the carrier reporting the parcel as delivered.
 */
export async function onFulfillmentUpdated({ shop, admin, fulfillment }) {
  if (fulfillment?.shipment_status !== "delivered") {
    return {
      queued: false,
      reason: `Not a delivery (shipment_status: ${fulfillment?.shipment_status ?? "none"})`,
    };
  }

  const order = await fetchOrder(admin, fulfillment.order_id, fulfillment);

  if (!order) {
    return { queued: false, reason: "Could not load the order for this fulfillment" };
  }

  return queueOrderSms({
    shop,
    admin,
    order,
    templateKey: "DELIVERY",
    smsType: "DELIVERY",
    dedupeKey: `DELIVERY:${fulfillment.id}`,
    tracking: extractTracking(fulfillment),
  });
}

/**
 * Load the order behind a fulfillment. Falls back to the fulfillment's own
 * destination address, which is enough to send to when the API call fails —
 * losing a delivery SMS because a query timed out would be a poor trade.
 */
async function fetchOrder(admin, orderId, fulfillment) {
  const fallback = fulfillment?.destination
    ? {
        id: orderId,
        order_number: null,
        name: fulfillment?.name ?? "",
        total_price: null,
        currency: "BDT",
        shipping_address: fulfillment.destination,
        customer: null,
      }
    : null;

  if (!admin || !orderId) return fallback;

  try {
    const response = await admin.graphql(
      `#graphql
        query OrderForFulfillment($id: ID!) {
          order(id: $id) {
            id
            name
            phone
            currencyCode
            totalPriceSet { shopMoney { amount currencyCode } }
            customer {
              id
              firstName
              lastName
              phone
              smsMarketingConsent { marketingState }
            }
            shippingAddress { phone firstName lastName name }
          }
        }`,
      { variables: { id: `gid://shopify/Order/${orderId}` } },
    );

    const body = await response.json();
    const order = body?.data?.order;

    if (!order) return fallback;

    // Map GraphQL back onto the REST shape the extractors expect, so there is
    // one payload format in this codebase rather than two.
    return {
      id: orderId,
      admin_graphql_api_id: order.id,
      name: order.name,
      order_number: String(order.name ?? "").replace(/^#/, ""),
      phone: order.phone,
      total_price: order.totalPriceSet?.shopMoney?.amount ?? null,
      currency: order.totalPriceSet?.shopMoney?.currencyCode ?? order.currencyCode ?? "BDT",
      customer: order.customer
        ? {
            id: order.customer.id,
            first_name: order.customer.firstName,
            last_name: order.customer.lastName,
            phone: order.customer.phone,
            sms_marketing_consent: {
              state:
                order.customer.smsMarketingConsent?.marketingState?.toLowerCase() ??
                null,
            },
          }
        : null,
      shipping_address: order.shippingAddress
        ? {
            phone: order.shippingAddress.phone,
            first_name: order.shippingAddress.firstName,
            last_name: order.shippingAddress.lastName,
            name: order.shippingAddress.name,
          }
        : null,
    };
  } catch {
    return fallback;
  }
}
