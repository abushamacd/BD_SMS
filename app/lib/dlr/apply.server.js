import db from "../../db.server.js";
import { normalizeBdPhone } from "../phone.js";
import { parseDlr } from "./parse.server.js";
import { shopForDlrToken } from "./token.server.js";

// Applying a delivery report to the log.
//
// The invariants, because this runs behind a PUBLIC endpoint:
//
//   1. Scope to the shop the token names. A report can only ever touch that
//      shop's rows — never another's, whatever the payload claims.
//   2. Only ever transition a SENT message. QUEUED/SKIPPED were never really
//      sent; DELIVERED/UNDELIVERED/FAILED are terminal. A DLR that would move a
//      terminal row is a late or duplicate report and is a no-op.
//   3. NEVER touch money. A delivered/undelivered report changes the displayed
//      status and nothing else. A message the gateway accepted was charged, and
//      a carrier failing to deliver it does not refund it — the operator billed
//      us regardless. This is also what makes the public endpoint safe: the worst
//      a forged report can do is mislabel a message, not move a balance.

/**
 * Find the SmsLog row a report is about.
 *
 * By provider message id when we have one — exact, and the normal path for
 * MiMSMS / SSL Wireless / generic providers.
 *
 * BulkSMSBD returns no id at send time, so there is nothing to match on but the
 * phone number. We take the most recent still-SENT message to that number for
 * this shop. It is best-effort and imperfect (two messages to the same number in
 * the same minute are ambiguous), which is a limitation of the provider, not a
 * shortcut — and it is scoped to the shop and to SENT rows, so the failure mode
 * is "attributed to the wrong one of this shop's own messages", never a leak.
 */
async function findMessage(shop, report) {
  if (report.providerMessageId) {
    const byId = await db.smsLog.findFirst({
      where: { shop, providerMessageId: report.providerMessageId },
    });

    if (byId) return byId;
    // Fall through to phone matching: some providers echo an id on the report
    // that they never gave us at send time.
  }

  if (report.phone) {
    const normalized = normalizeBdPhone(report.phone);
    const phone = normalized.valid ? normalized.e164 : report.phone;

    return db.smsLog.findFirst({
      where: { shop, phone, status: "SENT" },
      orderBy: { sentAt: "desc" },
    });
  }

  return null;
}

/**
 * A permanent failure means the number is dead — invalid, or on the operator's
 * do-not-disturb list. The blacklist page promises these are added automatically
 * "so you stop paying to text a number that will never receive anything", so we
 * keep that promise here.
 *
 * Only on a PERMANENT failure. A phone that was merely switched off is a soft
 * failure and must not cost the customer their future order confirmations.
 */
async function blacklistDeadNumber(shop, phone, reason) {
  const normalized = normalizeBdPhone(phone);
  if (!normalized.valid) return;

  await db.blacklist.upsert({
    where: { shop_phone: { shop, phone: normalized.e164 } },
    create: {
      shop,
      phone: normalized.e164,
      // "invalid number" is a bounce; DND is the operator list. Reason text
      // decides which — the enum is only two buckets.
      source: /dnd|do[-_ ]?not[-_ ]?disturb/i.test(reason ?? "") ? "DND" : "BOUNCED",
      note: `Auto-added from a delivery report: ${reason ?? "permanently undeliverable"}`,
    },
    // Never downgrade an existing entry — a number a customer opted out of with
    // STOP must keep that record, not be relabelled a bounce.
    update: {},
  });
}

/**
 * Process one delivery report.
 *
 * Returns a small result for logging. Always resolves — the route turns any
 * throw into a 200 so the gateway does not retry forever.
 */
export async function applyDlr(token, provider, fields) {
  const shop = await shopForDlrToken(token);

  // Unknown token: someone poked the endpoint, or a merchant rotated their token
  // and the provider is still using the old one. Nothing to do.
  if (!shop) return { ok: false, reason: "Unknown DLR token" };

  const report = parseDlr(provider, fields);

  if (!report) return { ok: false, reason: `Unknown provider ${provider}` };

  // PENDING (still in transit) and null (unreadable) are not outcomes to act on.
  if (report.status !== "DELIVERED" && report.status !== "UNDELIVERED") {
    return { ok: true, reason: `No actionable status (${report.reason ?? "unknown"})` };
  }

  const message = await findMessage(shop, report);

  if (!message) {
    return { ok: true, reason: "No matching message (already reported, or not ours)" };
  }

  // Conditional update: only a still-SENT row moves. If two reports race, or one
  // is redelivered, exactly one update finds status = SENT and the rest are
  // no-ops — the terminal state is sticky.
  const updated = await db.smsLog.updateMany({
    where: { id: message.id, status: "SENT" },
    data:
      report.status === "DELIVERED"
        ? { status: "DELIVERED", deliveredAt: new Date() }
        : {
            status: "UNDELIVERED",
            errorCode: report.permanent ? "DLR_PERMANENT" : "DLR_SOFT",
            errorMessage: `Not delivered: ${report.reason ?? "carrier reported failure"}`,
          },
  });

  if (updated.count === 0) {
    return { ok: true, reason: "Already in a final state" };
  }

  // Keep the campaign's delivered/failed tallies honest, if this was one.
  if (message.campaignId) {
    await db.campaign.update({
      where: { id: message.campaignId },
      data:
        report.status === "DELIVERED"
          ? { deliveredCount: { increment: 1 } }
          : { failedCount: { increment: 1 } },
    }).catch(() => {}); // a deleted campaign must not fail the report
  }

  // A permanently dead number earns its place on the blacklist.
  if (report.status === "UNDELIVERED" && report.permanent) {
    await blacklistDeadNumber(shop, message.phone, report.reason);
  }

  return {
    ok: true,
    reason: report.status,
    messageId: message.id,
    blacklisted: report.status === "UNDELIVERED" && report.permanent,
  };
}
