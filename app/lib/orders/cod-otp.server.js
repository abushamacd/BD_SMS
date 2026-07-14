import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import db from "../../db.server.js";
import { hashOtp } from "../crypto.server.js";
import { enqueue } from "../queue/queue.server.js";
import { getSettings, getTemplate } from "../settings.server.js";
import { renderMessage } from "../templates.server.js";
import {
  extractCustomerName,
  extractOrderNumber,
  extractPhone,
  formatMoney,
} from "./extract.server.js";

// COD OTP verification.
//
// Shopify's checkout cannot be blocked — there is no way to hold order creation
// while an SMS round-trips. So this is post-order confirmation, which is what
// every working BD app does:
//
//   COD order placed → tagged `cod-unconfirmed` → OTP SMS sent
//   → customer opens the link and enters the code → tagged `cod-confirmed`
//
// The merchant ships only confirmed orders. That kills fake COD orders just as
// effectively as blocking checkout would, and it works on every Shopify plan.

const OTP_TTL_HOURS = 24; // a customer may not see the SMS for hours; 5 minutes would fail most real orders
const OTP_PRIORITY = 10; // outranks everything — a customer is waiting on this

export const TAG_CONFIRMED = "cod-confirmed";
export const TAG_UNCONFIRMED = "cod-unconfirmed";

/** Six digits, from a CSPRNG. Math.random() is predictable and must never mint a code. */
function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** URL-safe, unguessable, and not derived from the order id. */
function generateToken() {
  return randomBytes(16).toString("base64url");
}

async function tagOrder(admin, orderGid, { add = [], remove = [] }) {
  if (!admin || !orderGid) return;

  try {
    if (remove.length > 0) {
      await admin.graphql(
        `#graphql
          mutation RemoveTags($id: ID!, $tags: [String!]!) {
            tagsRemove(id: $id, tags: $tags) { userErrors { message } }
          }`,
        { variables: { id: orderGid, tags: remove } },
      );
    }

    if (add.length > 0) {
      await admin.graphql(
        `#graphql
          mutation AddTags($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) { userErrors { message } }
          }`,
        { variables: { id: orderGid, tags: add } },
      );
    }
  } catch (error) {
    // Tagging is how the merchant sees the state, but failing to tag must not
    // stop the OTP being sent — the customer is waiting.
    console.error("[cod-otp] failed to tag order:", error.message);
  }
}

/**
 * A COD order was placed. Mint a code, tag the order unconfirmed, and queue the
 * SMS.
 */
export async function startCodVerification({ shop, admin, order }) {
  const template = await getTemplate(shop, "COD_OTP");

  if (!template?.enabled) {
    return { queued: false, reason: "COD_OTP is disabled" };
  }

  const phone = extractPhone(order);

  if (!phone) {
    return { queued: false, reason: "The order has no phone number" };
  }

  const settings = await getSettings(shop);
  const orderGid = String(order.admin_graphql_api_id ?? `gid://shopify/Order/${order.id}`);

  const code = generateCode();
  const token = generateToken();
  const orderNumber = extractOrderNumber(order);

  // One live OTP per order. A resend replaces the row (new code, new token), so
  // an old code stops working the moment a new one is sent.
  await db.codOtp.upsert({
    where: { shop_orderId: { shop, orderId: orderGid } },
    create: {
      shop,
      orderId: orderGid,
      orderNumber,
      orderTotal: formatMoney(order.total_price, order.currency ?? "BDT"),
      phone,
      token,
      codeHash: hashOtp(code, shop),
      expiresAt: new Date(Date.now() + OTP_TTL_HOURS * 3600_000),
    },
    update: {
      token,
      codeHash: hashOtp(code, shop),
      status: "PENDING",
      attempts: 0,
      expiresAt: new Date(Date.now() + OTP_TTL_HOURS * 3600_000),
      verifiedAt: null,
    },
  });

  await tagOrder(admin, orderGid, { add: [TAG_UNCONFIRMED], remove: [TAG_CONFIRMED] });

  const appUrl = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");

  const rendered = renderMessage(template.body, {
    customer_name: extractCustomerName(order),
    order_number: orderNumber,
    order_total: formatMoney(order.total_price, order.currency ?? "BDT"),
    shop_name: settings.shopName ?? shop.replace(/\.myshopify\.com$/, ""),
    otp_code: code,
    confirm_url: `${appUrl}/confirm/${token}`,
  });

  if (rendered.blocked) {
    return { queued: false, reason: rendered.reason };
  }

  await enqueue({
    shop,
    type: "SEND_SMS",
    priority: OTP_PRIORITY,
    dedupeKey: `${shop}:COD_OTP:${order.id}`,
    payload: {
      shop,
      phone,
      message: rendered.text,
      type: "COD_OTP",
      dedupeKey: `COD_OTP:${order.id}`,
      customerName: extractCustomerName(order),
      customerId: order?.customer?.id ? String(order.customer.id) : null,
      orderId: orderGid,
      // Transactional: a customer who never opted into marketing still needs the
      // code that confirms their own order.
      smsConsent: false,
    },
  });

  // Expire it later, so an unconfirmed order does not sit PENDING forever.
  await enqueue({
    shop,
    type: "COD_OTP_EXPIRE",
    runAt: new Date(Date.now() + OTP_TTL_HOURS * 3600_000),
    dedupeKey: `${shop}:COD_OTP_EXPIRE:${order.id}`,
    payload: { shop, orderId: orderGid },
  });

  return { queued: true };
}

export const VerifyResult = {
  OK: "OK",
  NOT_FOUND: "NOT_FOUND",
  ALREADY_VERIFIED: "ALREADY_VERIFIED",
  EXPIRED: "EXPIRED",
  WRONG_CODE: "WRONG_CODE",
  TOO_MANY_ATTEMPTS: "TOO_MANY_ATTEMPTS",
};

export async function findOtpByToken(token) {
  if (!token) return null;
  return db.codOtp.findUnique({ where: { token } });
}

/**
 * Verify a code. Rate-limited by attempts: without a cap, six digits is a
 * million guesses an attacker can walk through in minutes.
 */
export async function verifyCode(token, code) {
  const otp = await findOtpByToken(token);

  if (!otp) return { result: VerifyResult.NOT_FOUND };
  if (otp.status === "VERIFIED") {
    return { result: VerifyResult.ALREADY_VERIFIED, otp };
  }
  if (otp.status === "FAILED" || otp.attempts >= otp.maxAttempts) {
    return { result: VerifyResult.TOO_MANY_ATTEMPTS, otp };
  }
  if (otp.expiresAt < new Date()) {
    await db.codOtp.update({
      where: { id: otp.id },
      data: { status: "EXPIRED" },
    });
    return { result: VerifyResult.EXPIRED, otp };
  }

  const submitted = hashOtp(String(code ?? "").trim(), otp.shop);

  // Constant-time compare: a plain === leaks how much of the hash matched via
  // timing, which is exactly the signal a brute-forcer wants.
  const expected = Buffer.from(otp.codeHash, "hex");
  const actual = Buffer.from(submitted, "hex");
  const matches =
    expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    const updated = await db.codOtp.update({
      where: { id: otp.id },
      data: {
        attempts: { increment: 1 },
        status: otp.attempts + 1 >= otp.maxAttempts ? "FAILED" : "PENDING",
      },
    });

    return {
      result:
        updated.attempts >= updated.maxAttempts
          ? VerifyResult.TOO_MANY_ATTEMPTS
          : VerifyResult.WRONG_CODE,
      otp: updated,
      remaining: Math.max(0, updated.maxAttempts - updated.attempts),
    };
  }

  const verified = await db.codOtp.update({
    where: { id: otp.id },
    data: { status: "VERIFIED", verifiedAt: new Date() },
  });

  return { result: VerifyResult.OK, otp: verified };
}

/** Swap the tags after a successful confirmation. Needs an offline session. */
export async function markOrderConfirmed(shop, orderId) {
  const { unauthenticated } = await import("../../shopify.server.js");

  try {
    const { admin } = await unauthenticated.admin(shop);

    await tagOrder(admin, orderId, {
      add: [TAG_CONFIRMED],
      remove: [TAG_UNCONFIRMED],
    });

    return true;
  } catch (error) {
    console.error("[cod-otp] could not tag confirmed order:", error.message);
    return false;
  }
}

/** The OTP_EXPIRE job. An unconfirmed order stays tagged unconfirmed. */
export async function expireCodOtp({ shop, orderId }) {
  await db.codOtp.updateMany({
    where: { shop, orderId, status: "PENDING" },
    data: { status: "EXPIRED" },
  });
}
