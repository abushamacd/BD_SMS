import db from "../../db.server.js";
import { checkLowBalance } from "./autorecharge.server.js";
import { planMonthlyLimit } from "./plans.js";

// Two billing modes, one question: "may this shop send one more message, and what
// does that cost them?"
//
//   DEFAULT mode  — the shop sends through OUR gateway. It spends credits it
//     bought from us. The limit is its credit balance, and every message is an
//     entry in the CreditLedger, because that ledger is an account of money we
//     are holding on their behalf.
//
//   PERSONAL mode — the shop sends through ITS OWN gateway. It spends its own
//     provider's balance; we never touch a credit, and NO LEDGER ENTRY IS WRITTEN
//     — a ledger of a balance we do not hold would be a fiction, and a `SEND` row
//     for 0 credits would make the merchant's statement unreadable. What limits
//     them is the plan they pay us for, so that allowance is what we count.
//
// Both are enforced the same way: a conditional UPDATE whose WHERE clause is the
// lock. Reading the balance and then writing it back would let two concurrent
// sends both pass the check and both spend the last message.

const PERIOD_MS = 30 * 24 * 3600 * 1000;

/** Outcomes, so the send path can say exactly why it refused. */
export const Allowance = {
  OK: "OK",
  NO_SUBSCRIPTION: "NO_SUBSCRIPTION",
  PLAN_LIMIT: "PLAN_LIMIT",
  INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
};

/**
 * Roll the billing period over if it has run out.
 *
 * Conditional on the period we THINK is current, so two workers rolling over at
 * the same instant cannot reset the counter twice and hand out a double
 * allowance — the second update matches no rows.
 */
async function rollPeriodIfNeeded(settings) {
  const now = new Date();

  const startedAt = settings.periodStartedAt;
  const expired = !startedAt || now.getTime() - startedAt.getTime() >= PERIOD_MS;

  if (!expired) return settings;

  const rolled = await db.shopSettings.updateMany({
    where: { shop: settings.shop, periodStartedAt: startedAt },
    data: { periodUsage: 0, periodStartedAt: now },
  });

  if (rolled.count === 0) {
    // Someone else rolled it first. Their version is the truth.
    return db.shopSettings.findUnique({ where: { shop: settings.shop } });
  }

  return { ...settings, periodUsage: 0, periodStartedAt: now };
}

/**
 * Take `cost` from whatever this shop actually spends. Atomic.
 *
 * @returns {Promise<{ok: boolean, reason?: string, code?: string}>}
 */
export async function spendAllowance(settings, cost) {
  const shop = settings.shop;

  // --- Their own gateway: spend the plan allowance ------------------------
  if (settings.gatewayMode === "PERSONAL") {
    // Sending on your own gateway is what the subscription pays for. Without one
    // there is nothing to send against — and until now, nothing stopped it.
    if (!settings.subscriptionActive) {
      return {
        ok: false,
        code: Allowance.NO_SUBSCRIPTION,
        reason:
          "Sending through your own gateway needs an active subscription. Subscribe on the Billing page, or switch back to our gateway and buy credits.",
      };
    }

    const limit = planMonthlyLimit(settings.subscriptionPlan);

    // Unlimited plan. Still counted, so the merchant can see their usage.
    if (limit === null) {
      await db.shopSettings.update({
        where: { shop },
        data: { periodUsage: { increment: cost } },
      });

      return { ok: true, charged: 0 };
    }

    const current = await rollPeriodIfNeeded(settings);

    // The WHERE clause is the lock: only an update that still leaves the shop
    // inside its allowance is applied.
    const spent = await db.shopSettings.updateMany({
      where: { shop, periodUsage: { lte: limit - cost } },
      data: { periodUsage: { increment: cost } },
    });

    if (spent.count === 0) {
      return {
        ok: false,
        code: Allowance.PLAN_LIMIT,
        reason: `This month's plan limit of ${limit.toLocaleString()} SMS has been reached. Upgrade your plan to keep sending.`,
        used: current.periodUsage,
        limit,
      };
    }

    // Deliberately no CreditLedger row: we are not holding their money. The SmsLog
    // row is their record of the message, and their provider bills them for it.
    return { ok: true, charged: 0 };
  }

  // --- Our gateway: spend purchased credits -------------------------------
  const debited = await db.shopSettings.updateMany({
    where: { shop, creditBalance: { gte: cost } },
    data: { creditBalance: { decrement: cost } },
  });

  if (debited.count === 0) {
    return {
      ok: false,
      code: Allowance.INSUFFICIENT_CREDITS,
      reason: `Not enough credits — this message needs ${cost}`,
    };
  }

  // Usage is counted in both modes, so a merchant can see what they send
  // regardless of who they pay for it.
  const after = await db.shopSettings.update({
    where: { shop },
    data: { periodUsage: { increment: cost } },
  });

  // Did that take them below the line? Only queues a job — the send path must not
  // wait on a billing API call.
  await checkLowBalance(settings, after.creditBalance);

  return { ok: true, charged: cost, balanceAfter: after.creditBalance };
}

/**
 * Give it back. The gateway rejected the message, so nothing was delivered.
 *
 * Both modes are unwound — a message that never went out must not eat a
 * personal-gateway shop's plan allowance any more than it should eat a
 * default-gateway shop's credits.
 */
export async function refundAllowance(settings, cost, { smsLogId, reason } = {}) {
  const shop = settings.shop;

  if (cost <= 0) return;

  // Never below zero, whatever happens.
  await db.shopSettings.updateMany({
    where: { shop, periodUsage: { gte: cost } },
    data: { periodUsage: { decrement: cost } },
  });

  if (settings.gatewayMode === "PERSONAL") return; // no credits were taken

  const after = await db.shopSettings.update({
    where: { shop },
    data: { creditBalance: { increment: cost } },
  });

  await db.creditLedger.create({
    data: {
      shop,
      type: "REFUND",
      amount: cost,
      balanceAfter: after.creditBalance,
      description: `Refund — not delivered: ${reason ?? "gateway rejected"}`,
      smsLogId,
    },
  });
}

/** What the merchant has spent this billing period, and what they are allowed. */
export async function usageThisPeriod(shop) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (!settings) return null;

  const current = await rollPeriodIfNeeded(settings);
  const limit =
    settings.gatewayMode === "PERSONAL"
      ? planMonthlyLimit(settings.subscriptionPlan)
      : null;

  return {
    used: current.periodUsage,
    limit,
    startedAt: current.periodStartedAt,
    remaining: limit === null ? null : Math.max(0, limit - current.periodUsage),
  };
}
