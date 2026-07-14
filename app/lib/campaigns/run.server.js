import db from "../../db.server.js";
import { enqueue } from "../queue/queue.server.js";
import { takeSendToken } from "../queue/rate-limit.server.js";
import { SendOutcome, sendSms } from "../sms/send.server.js";
import { buildAudience } from "./audience.server.js";

// Campaign execution.
//
// One job per campaign, NOT one job per recipient. A 10,000-person campaign as
// 10,000 queue rows would make pause and cancel a hunt through the queue, and
// would bury every transactional message behind it.
//
// Instead the job sends a batch, updates the counters, and re-enqueues itself.
// That gives pause/resume/cancel for free — they are a status check between
// batches — and keeps an OTP's wait bounded by one batch, not by the whole
// campaign.

const BATCH_SIZE = 50;

// Below every transactional message. A customer waiting for an order
// confirmation must never queue behind a marketing blast.
const CAMPAIGN_PRIORITY = -10;

/**
 * The campaign cannot run and no retry will change that. The campaign row has
 * already been marked FAILED with the reason; this tells the queue not to
 * retry the job.
 */
export class CampaignFailed extends Error {
  constructor(message) {
    super(message);
    this.name = "CampaignFailed";
    this.retryable = false;
  }
}

/** Start (or restart) a campaign by putting it on the queue. */
export async function startCampaign(shop, campaignId, runAt = new Date()) {
  await enqueue({
    shop,
    type: "SEND_CAMPAIGN",
    priority: CAMPAIGN_PRIORITY,
    runAt,
    // Not deduped by campaign alone: a paused-then-resumed campaign must be able
    // to enqueue a fresh job after the old one completed.
    payload: { shop, campaignId },
  });
}

/**
 * Materialise the audience into CampaignRecipient rows.
 *
 * Done when the campaign STARTS, not when it is scheduled — so a customer who
 * opts out between scheduling and sending is never messaged. That is the promise
 * the scheduling UI makes.
 */
export async function buildRecipients(campaign, admin) {
  let result;

  try {
    result = await buildAudience(admin, campaign.segment);
  } catch (error) {
    // Shopify refused the audience query because the app is not approved for
    // protected customer data. Retrying cannot fix that — only the app owner
    // can, in the Partner Dashboard — so the campaign is failed with the reason
    // rather than left in SENDING while its job quietly retries and gets buried.
    if (error.protectedData) {
      await db.campaign.update({
        where: { id: campaign.id },
        data: { status: "FAILED", failureReason: error.message },
      });

      throw new CampaignFailed(error.message);
    }

    throw error;
  }

  if (result.recipients.length > 0) {
    // Skip duplicates rather than fail the whole batch: the unique index on
    // (campaignId, phone) is what guarantees one message per person, and a
    // resumed campaign re-running this must not explode.
    await db.campaignRecipient.createMany({
      data: result.recipients.map((recipient) => ({
        campaignId: campaign.id,
        phone: recipient.phone,
        customerId: recipient.customerId,
        customerName: recipient.customerName,
      })),
      skipDuplicates: true,
    });
  }

  const recipientCount = await db.campaignRecipient.count({
    where: { campaignId: campaign.id },
  });

  await db.campaign.update({
    where: { id: campaign.id },
    data: { recipientCount, startedAt: campaign.startedAt ?? new Date() },
  });

  console.log(
    `[campaign ${campaign.id}] audience: scanned ${result.scanned}, ` +
      `${recipientCount} recipients, ${result.skippedNoConsent} without consent, ` +
      `${result.skippedBadPhone} with an unusable number` +
      (result.truncated ? " (TRUNCATED at the 50,000 cap)" : ""),
  );

  return recipientCount;
}

/**
 * Run one slice of a campaign.
 *
 * @returns {{done: boolean, paused?: boolean, reason?: string}}
 */
export async function runCampaignBatch({ shop, campaignId }) {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });

  if (!campaign || campaign.shop !== shop) {
    return { done: true, reason: "Campaign not found" };
  }

  // --- Stop conditions, checked before every batch -------------------------
  if (campaign.status === "CANCELLED") {
    return { done: true, reason: "Cancelled" };
  }

  if (campaign.status === "PAUSED") {
    // Nothing is queued while paused. Resuming enqueues a fresh job.
    return { done: true, reason: "Paused" };
  }

  if (campaign.status === "COMPLETED") {
    return { done: true, reason: "Already completed" };
  }

  if (
    campaign.status === "SCHEDULED" &&
    campaign.scheduledFor &&
    campaign.scheduledFor > new Date()
  ) {
    return { done: false, rescheduleTo: campaign.scheduledFor };
  }

  // --- Build the audience on first run -------------------------------------
  if (campaign.status !== "SENDING") {
    await db.campaign.update({
      where: { id: campaignId },
      data: { status: "SENDING", startedAt: campaign.startedAt ?? new Date() },
    });
  }

  if (campaign.recipientCount === 0) {
    const { unauthenticated } = await import("../../shopify.server.js");
    const { admin } = await unauthenticated.admin(shop);

    const count = await buildRecipients(campaign, admin);

    if (count === 0) {
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      return { done: true, reason: "Nobody matched this audience" };
    }
  }

  // --- Send a batch --------------------------------------------------------
  const batch = await db.campaignRecipient.findMany({
    where: { campaignId, status: "QUEUED" },
    take: BATCH_SIZE,
  });

  if (batch.length === 0) {
    await db.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return { done: true, reason: "Completed" };
  }

  let sent = 0;
  let failed = 0;
  let credits = 0;

  // Counters must be written before ANY return out of this loop. Early exits
  // (out of credits, quiet hours, paused mid-batch) were losing the progress of
  // the batch that had already been sent: the recipient rows said SENT while the
  // campaign still said 0, so a resumed campaign under-reported what it had done.
  const flush = async () => {
    if (sent === 0 && failed === 0 && credits === 0) return;

    await db.campaign.update({
      where: { id: campaignId },
      data: {
        sentCount: { increment: sent },
        failedCount: { increment: failed },
        creditsUsed: { increment: credits },
      },
    });

    sent = 0;
    failed = 0;
    credits = 0;
  };

  for (const recipient of batch) {
    // Re-check between messages, not just between batches — a merchant hitting
    // Pause on a 10,000-person campaign should not wait for 50 more messages.
    const current = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });

    if (current.status === "PAUSED" || current.status === "CANCELLED") {
      break;
    }

    // Shared bucket: this is what keeps a campaign from firing faster than the
    // gateway allows.
    await takeSendToken();

    const result = await sendSms({
      shop,
      phone: recipient.phone,
      message: campaign.body,
      type: "CAMPAIGN",
      customerName: recipient.customerName,
      customerId: recipient.customerId,
      campaignId,
      // Consent was verified when the audience was built, minutes ago at most.
      // sendSms still re-checks the blacklist.
      smsConsent: true,
      // A campaign that hits quiet hours must pause, not defer each message
      // individually — handled below.
      ignoreQuietHours: false,
    });

    // Out of credits: stop the campaign rather than burn through the rest of the
    // audience marking everyone SKIPPED. The merchant can recharge and resume,
    // and nobody gets a message twice.
    if (result.outcome === SendOutcome.SKIPPED && result.reason?.includes("credits")) {
      await flush();

      await db.campaign.update({
        where: { id: campaignId },
        data: { status: "PAUSED" },
      });

      return {
        done: true,
        paused: true,
        reason: "Out of credits — recharge and resume this campaign",
      };
    }

    // Quiet hours: hold the whole campaign until they end.
    if (result.outcome === SendOutcome.DEFERRED) {
      await flush();
      return { done: false, rescheduleTo: result.runAt, reason: result.reason };
    }

    const status =
      result.outcome === SendOutcome.SENT
        ? "SENT"
        : result.outcome === SendOutcome.SKIPPED
          ? "SKIPPED"
          : "FAILED";

    await db.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status,
        smsLogId: result.smsLogId,
        error: result.reason ?? null,
      },
    });

    if (status === "SENT") {
      sent += 1;
      credits += result.credits ?? 0;
    } else if (status === "FAILED") {
      failed += 1;
    }
  }

  // Counters are incremented, never recomputed — counting recipient rows on
  // every batch would get slower as the campaign progresses.
  await flush();

  const remaining = await db.campaignRecipient.count({
    where: { campaignId, status: "QUEUED" },
  });

  if (remaining === 0) {
    await db.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return { done: true, reason: "Completed" };
  }

  // More to do — go round again.
  return { done: false, rescheduleTo: new Date() };
}

// --- Merchant controls -----------------------------------------------------

export async function pauseCampaign(shop, campaignId) {
  return db.campaign.updateMany({
    where: { id: campaignId, shop, status: { in: ["SENDING", "SCHEDULED"] } },
    data: { status: "PAUSED" },
  });
}

export async function resumeCampaign(shop, campaignId) {
  const updated = await db.campaign.updateMany({
    where: { id: campaignId, shop, status: "PAUSED" },
    data: { status: "SENDING" },
  });

  if (updated.count > 0) await startCampaign(shop, campaignId);

  return updated;
}

export async function cancelCampaign(shop, campaignId) {
  // Recipients already sent stay SENT — the messages are gone and the credits
  // are spent. Only the unsent remainder is cancelled.
  await db.campaignRecipient.updateMany({
    where: { campaignId, status: "QUEUED" },
    data: { status: "SKIPPED", error: "Campaign cancelled" },
  });

  return db.campaign.updateMany({
    where: {
      id: campaignId,
      shop,
      status: { in: ["SENDING", "SCHEDULED", "PAUSED", "DRAFT"] },
    },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
}
