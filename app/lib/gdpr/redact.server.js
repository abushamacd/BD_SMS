import db from "../../db.server.js";
import { normalizeBdPhone } from "../phone.js";

// The three mandatory GDPR webhooks.
//
// Shopify will not approve an app without them, and they are the only webhooks
// where doing nothing is a legal problem rather than a bug.
//
//   customers/data_request — a customer asked what you hold on them. The merchant
//     has 30 days to answer, so the export is compiled NOW and stored, not logged
//     and forgotten.
//   customers/redact       — erase that customer. Arrives at least 10 days after
//     the request, so any order data has already settled.
//   shop/redact            — the merchant uninstalled 48 hours ago. Erase the shop.

/** Every phone spelling we might have stored this person under. */
function phoneVariants(raw) {
  if (!raw) return [];

  const normalized = normalizeBdPhone(raw);
  const variants = new Set([String(raw)]);

  if (normalized.valid) variants.add(normalized.e164);

  return [...variants];
}

/**
 * Everything we hold on one customer.
 *
 * Matched on BOTH customer id and phone number. Id alone is not enough: an SMS to
 * a guest checkout has a phone number and no customer record, and that message is
 * still their data.
 */
export async function compileCustomerData(shop, customer) {
  const phones = phoneVariants(customer?.phone);
  const customerId = customer?.id ? String(customer.id) : null;

  const match = {
    shop,
    OR: [
      ...(customerId ? [{ customerId }] : []),
      ...(phones.length ? [{ phone: { in: phones } }] : []),
    ],
  };

  // Nothing to match on. Return an empty export rather than a filter of `OR: []`,
  // which matches every row in the shop — this is the query where getting that
  // wrong would hand one customer everybody else's messages.
  if (match.OR.length === 0) {
    return { messages: [], abandonedCheckouts: [], optOut: null, empty: true };
  }

  const [messages, checkouts, blacklist] = await Promise.all([
    db.smsLog.findMany({
      where: match,
      select: {
        createdAt: true,
        type: true,
        phone: true,
        customerName: true,
        body: true,
        status: true,
        credits: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.abandonedCheckout.findMany({
      where: match,
      select: {
        createdAt: true,
        phone: true,
        customerName: true,
        email: true,
        cartValue: true,
        currency: true,
        status: true,
      },
    }),
    phones.length
      ? db.blacklist.findFirst({ where: { shop, phone: { in: phones } } })
      : null,
  ]);

  return {
    customer: { id: customerId, phone: customer?.phone ?? null, email: customer?.email ?? null },
    messages: messages.map((message) => ({
      sentAt: message.createdAt.toISOString(),
      type: message.type,
      to: message.phone,
      name: message.customerName,
      message: message.body,
      status: message.status,
      credits: message.credits,
    })),
    abandonedCheckouts: checkouts.map((checkout) => ({
      at: checkout.createdAt.toISOString(),
      phone: checkout.phone,
      name: checkout.customerName,
      email: checkout.email,
      cartValue: Number(checkout.cartValue),
      currency: checkout.currency,
      status: checkout.status,
    })),
    optOut: blacklist
      ? { phone: blacklist.phone, reason: blacklist.source, since: blacklist.createdAt.toISOString() }
      : null,
    compiledAt: new Date().toISOString(),
  };
}

/** customers/data_request. */
export async function onDataRequest({ shop, payload }) {
  const customer = payload?.customer;
  const requestId = String(
    payload?.data_request?.id ?? `${shop}:${customer?.id ?? "unknown"}`,
  );

  const data = await compileCustomerData(shop, customer);

  await db.dataRequest.upsert({
    where: { requestId },
    create: {
      shop,
      requestId,
      customerId: customer?.id ? String(customer.id) : null,
      phone: customer?.phone ?? null,
      email: customer?.email ?? null,
      data,
    },
    // A redelivered webhook must not overwrite an export the merchant may already
    // have sent.
    update: {},
  });

  console.log(
    `[gdpr] data request ${requestId} for ${shop}: ${data.messages?.length ?? 0} messages, ` +
      `${data.abandonedCheckouts?.length ?? 0} abandoned checkouts`,
  );

  return { acted: true, reason: `compiled export for request ${requestId}` };
}

/**
 * customers/redact.
 *
 * The judgment call here is the opt-out list.
 *
 * Erasing a customer who previously replied STOP would delete the only record
 * that they told us to stop texting them — so the next time the merchant imports
 * that number, we would text them again. That is the precise harm the erasure is
 * meant to prevent, achieved by complying with it literally.
 *
 * So the suppression entry is KEPT (phone number only, name and notes stripped),
 * on the same basis every messaging platform keeps one: continuing to honour a
 * withdrawal of consent. Everything else about the customer is destroyed. Nobody
 * who was NOT already on the list is added to it.
 */
export async function onCustomerRedact({ shop, payload }) {
  const customer = payload?.customer;
  const phones = phoneVariants(customer?.phone);
  const customerId = customer?.id ? String(customer.id) : null;

  const or = [
    ...(customerId ? [{ customerId }] : []),
    ...(phones.length ? [{ phone: { in: phones } }] : []),
  ];

  if (or.length === 0) {
    return { acted: false, reason: "The webhook carried no customer id or phone" };
  }

  const match = { shop, OR: or };

  // SMS log: anonymised, not deleted. The row is also an accounting record — it
  // says a credit was spent — and destroying it would corrupt the ledger the
  // merchant is billed against. What is destroyed is everything that identifies a
  // person: the number, the name, and the message body (which carries their name
  // and what they bought).
  const messages = await db.smsLog.updateMany({
    where: match,
    data: {
      phone: "[redacted]",
      customerName: null,
      customerId: null,
      body: "[redacted]",
    },
  });

  // Nothing here is needed for accounting, and all of it is personal.
  const checkouts = await db.abandonedCheckout.deleteMany({ where: match });
  const otps = await db.codOtp.deleteMany({
    where: {
      shop,
      ...(phones.length ? { phone: { in: phones } } : {}),
    },
  });

  // Deleted, not anonymised — and that is forced, not a preference.
  // CampaignRecipient is unique on (campaignId, phone), so blanking two different
  // redacted customers' numbers to the same "[redacted]" string in one campaign
  // would collide on the second one and make this webhook fail forever. The
  // campaign's totals live on the Campaign row, so deleting these costs no
  // reporting accuracy.
  const recipients = await db.campaignRecipient.deleteMany({
    where: {
      campaign: { shop },
      OR: [
        ...(customerId ? [{ customerId }] : []),
        ...(phones.length ? [{ phone: { in: phones } }] : []),
      ],
    },
  });

  // The opt-out itself survives — see the note above. Its personal details do not.
  const optOut = phones.length
    ? await db.blacklist.updateMany({
        where: { shop, phone: { in: phones } },
        data: { name: null, note: "Customer data erased at their request" },
      })
    : { count: 0 };

  console.log(
    `[gdpr] redacted customer for ${shop}: ${messages.count} messages, ` +
      `${checkouts.count} checkouts, ${otps.count} OTPs, ${recipients.count} campaign rows, ` +
      `${optOut.count} opt-out records kept but anonymised`,
  );

  return {
    acted: true,
    reason: `redacted ${messages.count} messages`,
    counts: {
      messages: messages.count,
      checkouts: checkouts.count,
      otps: otps.count,
      recipients: recipients.count,
      optOutKept: optOut.count,
    },
  };
}

/**
 * shop/redact — 48 hours after the merchant uninstalled. Erase the shop.
 *
 * Deleted in dependency order: a CampaignRecipient points at a Campaign, so the
 * children go first. The gateway row matters most — it holds the merchant's
 * encrypted SMS provider credentials, and there is no reason on earth to keep
 * those after they have left.
 */
export async function onShopRedact({ shop }) {
  const deleted = {};

  await db.campaignRecipient.deleteMany({ where: { campaign: { shop } } });

  for (const table of [
    "smsLog",
    "creditLedger",
    "campaign",
    "abandonedCheckout",
    "codOtp",
    "blacklist",
    "messageTemplate",
    "job",
    "gateway",
    "purchase",
    "dataRequest",
    "processedWebhook",
    "shopSettings",
    "session",
  ]) {
    const result = await db[table].deleteMany({ where: { shop } });
    if (result.count > 0) deleted[table] = result.count;
  }

  console.log(`[gdpr] shop redacted: ${shop}`, deleted);

  return { acted: true, reason: `erased all data for ${shop}`, deleted };
}
