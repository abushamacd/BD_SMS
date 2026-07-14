import db from "../../db.server.js";
import { enqueue } from "../queue/queue.server.js";
import { CURRENCY, chargeName, getPackage } from "./plans.js";
import { isTestBilling } from "./shopify.server.js";

// Auto-recharge.
//
// A one-off charge (appPurchaseOneTimeCreate) ALWAYS makes the merchant click an
// approval screen, so no app can quietly buy them credits with one. The only
// mechanism Shopify gives us is a USAGE subscription: the merchant approves a
// monthly spending CAP once, and individual charges are then billed against that
// cap with appUsageRecordCreate — no further approval, and never more than the
// cap they agreed to.
//
// So enabling auto-recharge is itself a subscription the merchant must approve.
// That is not a workaround; it is the consent this feature is built on. This is
// the one place in the app that spends a merchant's money without asking each
// time, and every guard below exists because of that:
//
//   - the cap is theirs, and Shopify enforces it independently of us;
//   - `autoRechargeInFlight` is a lock, so two workers reacting to the same low
//     balance cannot both buy a package;
//   - the charge carries an idempotencyKey, so a network timeout that we retry
//     cannot bill them twice for one recharge;
//   - a failed recharge is recorded and shown, never retried silently.

/** Default cap. Enough for a few recharges, small enough not to alarm anyone. */
export const DEFAULT_CAP = 100;

const USAGE_SUBSCRIPTION_CREATE = `#graphql
  mutation CreateAutoRecharge(
    $name: String!
    $returnUrl: URL!
    $test: Boolean
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      lineItems: $lineItems
      replacementBehavior: STANDARD
    ) {
      appSubscription {
        id
        status
        lineItems { id }
      }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

const USAGE_RECORD_CREATE = `#graphql
  mutation ChargeAutoRecharge(
    $description: String!
    $price: MoneyInput!
    $subscriptionLineItemId: ID!
    $idempotencyKey: String
  ) {
    appUsageRecordCreate(
      description: $description
      price: $price
      subscriptionLineItemId: $subscriptionLineItemId
      idempotencyKey: $idempotencyKey
    ) {
      appUsageRecord {
        id
        price { amount currencyCode }
        subscriptionLineItem {
          plan {
            pricingDetails {
              ... on AppUsagePricing {
                balanceUsed { amount }
                cappedAmount { amount }
              }
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

function firstError(userErrors) {
  if (!userErrors?.length) return null;
  return userErrors.map((error) => error.message).join(" ");
}

/**
 * Turn auto-recharge on. Returns a confirmation URL — the merchant has to approve
 * the spending cap, because we are asking permission to charge them later without
 * asking again.
 */
export async function enableAutoRecharge(admin, shop, { packageId, cap, returnUrl }) {
  const pkg = getPackage(packageId);

  if (!pkg) return { ok: false, error: "That credit package does not exist." };

  const amount = Number(cap) || DEFAULT_CAP;

  if (amount < pkg.price) {
    return {
      ok: false,
      error: `Your monthly limit (${CURRENCY} ${amount}) is less than the ${pkg.credits.toLocaleString()}-credit package costs (${CURRENCY} ${pkg.price}), so no recharge could ever go through.`,
    };
  }

  const test = isTestBilling();

  const response = await admin.graphql(USAGE_SUBSCRIPTION_CREATE, {
    variables: {
      name: "BD SMS credit auto-recharge",
      returnUrl,
      test,
      lineItems: [
        {
          plan: {
            appUsagePricingDetails: {
              // The merchant sees these words on the approval screen, so they must
              // say exactly what they are agreeing to.
              terms: `Automatically buys ${pkg.credits.toLocaleString()} SMS credits for ${CURRENCY} ${pkg.price} whenever your balance runs low. Never more than ${CURRENCY} ${amount} per month.`,
              cappedAmount: { amount, currencyCode: CURRENCY },
            },
          },
        },
      ],
    },
  });

  const body = await response.json();
  const result = body?.data?.appSubscriptionCreate;
  const error = firstError(result?.userErrors);

  if (error || !result?.confirmationUrl) {
    return {
      ok: false,
      error: error ?? "Shopify would not set up auto-recharge. Please try again.",
    };
  }

  const subscription = result.appSubscription;

  await db.purchase.create({
    data: {
      shop,
      chargeId: subscription.id,
      kind: "AUTO_RECHARGE",
      name: "Credit auto-recharge",
      packageId: pkg.id,
      credits: 0, // the approval buys nothing by itself
      amount,
      currency: CURRENCY,
      status: "PENDING",
      test,
    },
  });

  // Saved, but NOT switched on: `autoRechargeEnabled` is only set once Shopify
  // confirms the merchant actually approved the cap. See reconcileAutoRecharge.
  await db.shopSettings.update({
    where: { shop },
    data: {
      autoRechargeChargeId: subscription.id,
      autoRechargeLineItemId: subscription.lineItems?.[0]?.id ?? null,
      autoRechargeCap: amount,
      autoRechargePackage: pkg.id,
      autoRechargeFailedAt: null,
      autoRechargeError: null,
    },
  });

  return { ok: true, confirmationUrl: result.confirmationUrl };
}

/** Turn it off. The usage subscription is cancelled — we keep no standing permission we are not using. */
export async function disableAutoRecharge(admin, shop) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (settings?.autoRechargeChargeId) {
    const response = await admin.graphql(
      `#graphql
        mutation CancelAutoRecharge($id: ID!) {
          appSubscriptionCancel(id: $id) {
            appSubscription { id status }
            userErrors { field message }
          }
        }`,
      { variables: { id: settings.autoRechargeChargeId } },
    );

    const body = await response.json();
    const error = firstError(body?.data?.appSubscriptionCancel?.userErrors);

    // A subscription Shopify has already ended is not an error worth blocking on.
    if (error) console.warn(`[autorecharge] cancel: ${error}`);

    await db.purchase.updateMany({
      where: { chargeId: settings.autoRechargeChargeId },
      data: { status: "CANCELLED" },
    });
  }

  await db.shopSettings.update({
    where: { shop },
    data: {
      autoRechargeEnabled: false,
      autoRechargeChargeId: null,
      autoRechargeLineItemId: null,
      autoRechargeCap: null,
      autoRechargeInFlight: false,
      autoRechargeFailedAt: null,
      autoRechargeError: null,
    },
  });

  return { ok: true };
}

/**
 * The merchant approved (or refused) the cap. Called from the billing reconcile.
 *
 * `autoRechargeEnabled` is set HERE and nowhere else — never when the merchant
 * clicks the switch. Between clicking and approving they may simply close the tab,
 * and an app that believed it had permission to charge them because they clicked a
 * toggle would be charging them without consent.
 */
export async function reconcileAutoRecharge(shop, activeSubscriptions) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (!settings?.autoRechargeChargeId) return false;

  const active = activeSubscriptions.find(
    (subscription) =>
      subscription.id === settings.autoRechargeChargeId &&
      subscription.status === "ACTIVE",
  );

  await db.shopSettings.update({
    where: { shop },
    data: { autoRechargeEnabled: Boolean(active) },
  });

  if (active) {
    await db.purchase.updateMany({
      where: { chargeId: active.id },
      data: { status: "ACTIVE" },
    });
  }

  return Boolean(active);
}

/**
 * The balance is low. Buy a package — without asking, because they already said
 * we could, up to a cap they chose.
 */
export async function runAutoRecharge({ shop, admin: injectedAdmin = null }) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (!settings) return { recharged: false, reason: "No such shop" };

  if (settings.gatewayMode !== "DEFAULT") {
    return { recharged: false, reason: "This shop does not spend our credits" };
  }

  if (!settings.autoRechargeEnabled || !settings.autoRechargeLineItemId) {
    return { recharged: false, reason: "Auto-recharge is off" };
  }

  // Someone topped up by hand while this job sat in the queue.
  if (settings.creditBalance >= settings.lowBalanceThreshold) {
    return { recharged: false, reason: "The balance is no longer low" };
  }

  const pkg = getPackage(settings.autoRechargePackage);

  if (!pkg) {
    return { recharged: false, reason: "No credit package is configured" };
  }

  // --- The lock ----------------------------------------------------------
  // Two workers can easily see the same low balance. The WHERE clause is what
  // stops both of them buying a package.
  const claimed = await db.shopSettings.updateMany({
    where: { shop, autoRechargeInFlight: false },
    data: { autoRechargeInFlight: true },
  });

  if (claimed.count === 0) {
    return { recharged: false, reason: "A recharge is already running" };
  }

  try {
    // The job has no request to authenticate, so it borrows the shop's offline
    // token — the same way campaigns do.
    const admin =
      injectedAdmin ??
      (await (await import("../../shopify.server.js")).unauthenticated.admin(shop))
        .admin;

    // Same key for the same recharge, so a retry after a network timeout — where
    // Shopify may already have recorded the charge — cannot bill them twice.
    const idempotencyKey = `${shop}:recharge:${settings.autoRechargeChargeId}:${settings.creditBalance}:${pkg.id}`;

    const response = await admin.graphql(USAGE_RECORD_CREATE, {
      variables: {
        description: chargeName(pkg),
        price: { amount: pkg.price, currencyCode: CURRENCY },
        subscriptionLineItemId: settings.autoRechargeLineItemId,
        idempotencyKey,
      },
    });

    const body = await response.json();
    const result = body?.data?.appUsageRecordCreate;
    const error = firstError(result?.userErrors);

    if (error || !result?.appUsageRecord) {
      // Almost always: the monthly cap is used up. Not retried — retrying a
      // refused charge just refuses again, and the merchant needs to know.
      const message = error ?? "Shopify refused the recharge.";

      await db.shopSettings.update({
        where: { shop },
        data: {
          autoRechargeFailedAt: new Date(),
          autoRechargeError: message,
          autoRechargeInFlight: false,
        },
      });

      console.warn(`[autorecharge] ${shop}: ${message}`);

      return { recharged: false, reason: message, failed: true };
    }

    const record = result.appUsageRecord;

    // Recorded as a purchase, then credited through the SAME idempotent path a
    // manual purchase uses — one grant per charge id, whatever happens.
    await db.purchase.create({
      data: {
        shop,
        chargeId: record.id,
        kind: "CREDITS",
        name: `${chargeName(pkg)} (auto-recharge)`,
        packageId: pkg.id,
        credits: pkg.credits,
        amount: pkg.price,
        currency: CURRENCY,
        status: "ACTIVE",
        test: isTestBilling(),
      },
    });

    const after = await db.shopSettings.update({
      where: { shop },
      data: {
        creditBalance: { increment: pkg.credits },
        // Topped up, so the "you are low" warning may fire again next time.
        lowBalanceNotifiedAt: null,
        autoRechargeInFlight: false,
        autoRechargeFailedAt: null,
        autoRechargeError: null,
      },
    });

    await db.purchase.update({
      where: { chargeId: record.id },
      data: { creditedAt: new Date() },
    });

    await db.creditLedger.create({
      data: {
        shop,
        type: "PURCHASE",
        amount: pkg.credits,
        balanceAfter: after.creditBalance,
        description: `Auto-recharge: ${pkg.credits.toLocaleString()} credits for ${CURRENCY} ${pkg.price}`,
        chargeId: record.id,
      },
    });

    console.log(
      `[autorecharge] ${shop}: bought ${pkg.credits} credits for ${CURRENCY} ${pkg.price}, balance now ${after.creditBalance}`,
    );

    return { recharged: true, credits: pkg.credits, balance: after.creditBalance };
  } catch (error) {
    await db.shopSettings.update({
      where: { shop },
      data: {
        autoRechargeInFlight: false,
        autoRechargeFailedAt: new Date(),
        autoRechargeError: error.message,
      },
    });

    throw error;
  }
}

/**
 * The balance just dropped below the threshold.
 *
 * Called from the send path after a debit, so it must be cheap: it only puts a job
 * on the queue. The queue's dedupeKey does the rest — a shop sending 500 messages
 * as its balance runs out generates ONE alert, not 500.
 */
export async function checkLowBalance(settings, balanceAfter) {
  const shop = settings.shop;

  if (settings.gatewayMode !== "DEFAULT") return false;
  if (balanceAfter >= settings.lowBalanceThreshold) return false;

  // The CROSSING is claimed in the database, not deduplicated on the queue.
  //
  // A completed job keeps its dedupeKey forever, so keying the job on the shop
  // would fire one alert and then never fire again for the rest of the shop's
  // life. And a shop sending 500 messages as its balance runs out must not
  // generate 500 alerts. So the row itself is the lock: exactly one caller can
  // move lowBalanceNotifiedAt from null to a timestamp, and only that caller
  // queues the job. Topping up nulls it again, which re-arms the alert.
  const claimed = await db.shopSettings.updateMany({
    where: { shop, lowBalanceNotifiedAt: null },
    data: { lowBalanceNotifiedAt: new Date() },
  });

  if (claimed.count === 0) return false;

  await enqueue({
    shop,
    type: "LOW_BALANCE",
    // Above campaigns and reminders: this is what keeps the OTPs flowing.
    priority: 8,
    payload: { shop },
  });

  return true;
}
