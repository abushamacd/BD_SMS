import db from "../../db.server.js";
import { runAutoRecharge } from "./autorecharge.server.js";

// The low-balance alert.
//
// Runs when the balance crosses the threshold. If auto-recharge is on, it tops
// them up and there is nothing to warn about. If it is off — or it fails — the
// merchant is told, because the alternative is discovering it from a customer who
// never got their OTP.

/**
 * Warn the merchant by SMS, on the number THEY gave us.
 *
 * Deliberately not billed to them. Charging a merchant a credit to tell them they
 * are nearly out of credits is absurd, and worse, it cannot work: at a zero
 * balance the warning would be skipped for insufficient credits — the one moment
 * it matters most. So this bypasses the credit path entirely and we absorb it.
 */
async function textTheMerchant(settings) {
  if (!settings.alertPhone) return { sent: false, reason: "No alert number set" };

  const { getAdapterForShop } = await import("../gateways/index.server.js");
  const { normalizeBdPhone } = await import("../phone.js");
  const { segmentSms } = await import("../sms-credits.js");

  const phone = normalizeBdPhone(settings.alertPhone);

  if (!phone.valid) return { sent: false, reason: "The alert number is not valid" };

  const message =
    `BD SMS: your credit balance is low (${settings.creditBalance.toLocaleString()} left). ` +
    `Top up to keep your order and OTP messages sending.`;

  const adapter = await getAdapterForShop(settings.shop);

  const result = await adapter.send({
    phone: phone.e164,
    message,
    senderId: settings.senderId,
    reference: `low-balance-${settings.shop}`,
  });

  const segment = segmentSms(message);

  // Logged so the merchant can see we told them, and when. Credits recorded as 0:
  // this one was on us, and showing a cost here would be a charge they never paid.
  await db.smsLog.create({
    data: {
      shop: settings.shop,
      phone: phone.e164,
      customerName: "You (low balance alert)",
      type: "ALERT",
      body: message,
      encoding: segment.encoding,
      parts: segment.parts,
      credits: 0,
      provider: "BULKSMSBD",
      senderId: settings.senderId,
      status: result.ok ? "SENT" : "FAILED",
      errorMessage: result.ok ? null : result.errorMessage,
      sentAt: result.ok ? new Date() : null,
    },
  });

  return { sent: result.ok, reason: result.errorMessage };
}

/** The LOW_BALANCE job. */
export async function runLowBalanceAlert({ shop }) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (!settings) return { reason: "No such shop" };

  // They topped up between the crossing and this job running.
  if (settings.creditBalance >= settings.lowBalanceThreshold) {
    await db.shopSettings.update({
      where: { shop },
      data: { lowBalanceNotifiedAt: null },
    });

    return { reason: "The balance is no longer low" };
  }

  // Try to fix it before complaining about it.
  if (settings.autoRechargeEnabled) {
    const recharge = await runAutoRecharge({ shop });

    if (recharge.recharged) {
      return {
        acted: true,
        reason: `auto-recharged ${recharge.credits} credits`,
      };
    }

    // Auto-recharge was on and did not work — usually the monthly cap is spent.
    // That is MORE urgent than an ordinary low balance, not less: the merchant
    // believes this is handled.
    const alert = await textTheMerchant(await db.shopSettings.findUnique({ where: { shop } }));

    return {
      acted: true,
      reason: `auto-recharge failed (${recharge.reason}); alerted: ${alert.sent}`,
    };
  }

  const alert = await textTheMerchant(settings);

  return { acted: true, reason: `alerted: ${alert.sent} (${alert.reason ?? "ok"})` };
}
