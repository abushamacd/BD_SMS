import db from "../../db.server.js";
import {
  CURRENCY,
  chargeName,
  getPackage,
  getPlan,
  planChargeName,
} from "./plans.js";

// Shopify Billing.
//
// Two charge types, because there are two ways to use this app:
//
//   appPurchaseOneTimeCreate — a credit package. The merchant sends through OUR
//     gateway and buys credits from us. One-off, no renewal.
//   appSubscriptionCreate    — a monthly plan. The merchant brought their OWN
//     gateway, buys SMS from their own provider, and pays us for the app itself.
//     These merchants get no credits: charging them per message AND per month
//     would be billing twice for one SMS.
//
// The rule that shapes this module: WE NEVER GRANT CREDITS BECAUSE THE MERCHANT
// CAME BACK TO A URL. Shopify redirects them to our returnUrl after the
// confirmation screen, but that URL can be opened by anyone, revisited, bookmarked
// and refreshed. Credits are granted only after we ask Shopify what the charge's
// status actually is, and only once per charge id.

/**
 * A test charge is free and is never really billed. Shopify only allows real
 * charges on a live store anyway, but the danger runs the other way: a TEST
 * charge in production would hand out real credits for no money. So test
 * purchases only ever grant credits while the app itself is in test mode.
 */
export function isTestBilling() {
  return process.env.SHOPIFY_BILLING_TEST !== "false";
}

const PURCHASE_ONE_TIME = `#graphql
  mutation CreateCreditPurchase($name: String!, $price: MoneyInput!, $returnUrl: URL!, $test: Boolean) {
    appPurchaseOneTimeCreate(name: $name, price: $price, returnUrl: $returnUrl, test: $test) {
      appPurchaseOneTime { id name status test }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

const SUBSCRIPTION_CREATE = `#graphql
  mutation CreateSubscription(
    $name: String!
    $returnUrl: URL!
    $test: Boolean
    $lineItems: [AppSubscriptionLineItemInput!]!
    $replacementBehavior: AppSubscriptionReplacementBehavior
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      lineItems: $lineItems
      replacementBehavior: $replacementBehavior
    ) {
      appSubscription { id name status test currentPeriodEnd }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

const SUBSCRIPTION_CANCEL = `#graphql
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

// What Shopify says is true, which is the only thing we bill from.
const PAYMENTS_QUERY = `#graphql
  query AppPayments($endCursor: String) {
    currentAppInstallation {
      activeSubscriptions { id name status test currentPeriodEnd }
      oneTimePurchases(first: 250, sortKey: CREATED_AT, after: $endCursor) {
        edges { node { id name status test createdAt } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

function firstError(userErrors) {
  if (!userErrors?.length) return null;

  return userErrors.map((error) => error.message).join(" ");
}

/**
 * Start a credit purchase.
 *
 * The price comes from the package registry, never from the request. The browser
 * chooses WHICH package; it does not get to say what it costs.
 */
export async function startCreditPurchase(admin, shop, packageId, returnUrl) {
  const pkg = getPackage(packageId);

  if (!pkg) return { ok: false, error: "That credit package does not exist." };

  const test = isTestBilling();

  const response = await admin.graphql(PURCHASE_ONE_TIME, {
    variables: {
      name: chargeName(pkg),
      price: { amount: pkg.price, currencyCode: CURRENCY },
      returnUrl,
      test,
    },
  });

  const body = await response.json();
  const result = body?.data?.appPurchaseOneTimeCreate;
  const error = firstError(result?.userErrors);

  if (error || !result?.confirmationUrl) {
    return {
      ok: false,
      error: error ?? "Shopify would not create the charge. Please try again.",
    };
  }

  // Recorded BEFORE the merchant is sent to the confirmation screen, so a charge
  // they approve is one we already know about — even if they close the tab and
  // never come back to our returnUrl.
  await db.purchase.create({
    data: {
      shop,
      chargeId: result.appPurchaseOneTime.id,
      kind: "CREDITS",
      name: chargeName(pkg),
      packageId: pkg.id,
      credits: pkg.credits,
      amount: pkg.price,
      currency: CURRENCY,
      status: "PENDING",
      test,
    },
  });

  return { ok: true, confirmationUrl: result.confirmationUrl };
}

/** Start (or change) a subscription. */
export async function startSubscription(admin, shop, planId, returnUrl) {
  const plan = getPlan(planId);

  if (!plan) return { ok: false, error: "That plan does not exist." };

  const test = isTestBilling();

  const response = await admin.graphql(SUBSCRIPTION_CREATE, {
    variables: {
      name: planChargeName(plan),
      returnUrl,
      test,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              interval: "EVERY_30_DAYS",
              price: { amount: plan.price, currencyCode: CURRENCY },
            },
          },
        },
      ],
      // Upgrading replaces the old subscription and prorates it, rather than
      // leaving the merchant paying for two plans at once.
      replacementBehavior: "STANDARD",
    },
  });

  const body = await response.json();
  const result = body?.data?.appSubscriptionCreate;
  const error = firstError(result?.userErrors);

  if (error || !result?.confirmationUrl) {
    return {
      ok: false,
      error: error ?? "Shopify would not create the subscription. Please try again.",
    };
  }

  await db.purchase.create({
    data: {
      shop,
      chargeId: result.appSubscription.id,
      kind: "SUBSCRIPTION",
      name: planChargeName(plan),
      planId: plan.id,
      // No credits: this merchant sends through their own gateway.
      credits: 0,
      amount: plan.price,
      currency: CURRENCY,
      status: "PENDING",
      test,
    },
  });

  return { ok: true, confirmationUrl: result.confirmationUrl };
}

/**
 * Grant the credits for one approved purchase — exactly once, ever.
 *
 * The conditional update IS the lock, the same trick the send path uses to debit:
 * two concurrent reconciles (a merchant double-clicking back, a webhook landing
 * at the same moment) both try to claim the row, MySQL serialises them, and only
 * one gets count = 1. The loser grants nothing.
 */
async function grantCredits(purchase) {
  const claimed = await db.purchase.updateMany({
    where: { chargeId: purchase.chargeId, creditedAt: null },
    data: { creditedAt: new Date(), status: "ACTIVE" },
  });

  if (claimed.count === 0) return false; // already credited by someone else

  const settings = await db.shopSettings.update({
    where: { shop: purchase.shop },
    data: { creditBalance: { increment: purchase.credits } },
  });

  await db.creditLedger.create({
    data: {
      shop: purchase.shop,
      type: "PURCHASE",
      amount: purchase.credits,
      balanceAfter: settings.creditBalance,
      description: `Bought ${purchase.credits.toLocaleString()} credits for ${purchase.currency} ${purchase.amount}`,
      chargeId: purchase.chargeId,
    },
  });

  console.log(
    `[billing] ${purchase.shop}: granted ${purchase.credits} credits for ${purchase.chargeId}`,
  );

  return true;
}

/**
 * Ask Shopify what has actually been paid, and settle up.
 *
 * Called when the merchant lands back on the Billing page, and by the billing
 * webhooks. It is deliberately driven by Shopify's answer rather than by our own
 * assumptions: a merchant who approves a charge and then closes the tab has still
 * paid, and must still get their credits the next time we look.
 */
export async function reconcileBilling(admin, shop) {
  const purchases = [];
  let subscriptions = [];
  let endCursor = null;

  do {
    const response = await admin.graphql(PAYMENTS_QUERY, {
      variables: { endCursor },
    });

    const body = await response.json();
    const installation = body?.data?.currentAppInstallation;

    if (!installation) {
      throw new Error(
        `Could not read billing status: ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`,
      );
    }

    subscriptions = installation.activeSubscriptions ?? [];
    purchases.push(...installation.oneTimePurchases.edges.map((edge) => edge.node));

    endCursor = installation.oneTimePurchases.pageInfo.hasNextPage
      ? installation.oneTimePurchases.pageInfo.endCursor
      : null;
  } while (endCursor);

  let granted = 0;

  // --- Credit packages ----------------------------------------------------
  for (const charge of purchases) {
    const purchase = await db.purchase.findUnique({
      where: { chargeId: charge.id },
    });

    // Not ours, or from another shop's install. Ignore rather than trust it.
    if (!purchase || purchase.shop !== shop) continue;

    if (charge.status !== "ACTIVE") {
      // DECLINED / EXPIRED — record it so the merchant can see the attempt, but
      // grant nothing.
      if (purchase.status === "PENDING") {
        await db.purchase.update({
          where: { chargeId: charge.id },
          data: {
            status: charge.status === "DECLINED" ? "DECLINED" : "EXPIRED",
          },
        });
      }
      continue;
    }

    // A test charge cost nothing. Granting real credits for it in production
    // would be giving the app away.
    if (purchase.test && !isTestBilling()) {
      console.warn(
        `[billing] refusing to credit test charge ${charge.id} while billing is live`,
      );
      continue;
    }

    if (purchase.creditedAt) continue;

    if (await grantCredits(purchase)) granted += purchase.credits;
  }

  // --- Subscription -------------------------------------------------------
  const active = subscriptions.find((subscription) => subscription.status === "ACTIVE");

  if (active) {
    await db.purchase.updateMany({
      where: { chargeId: active.id },
      data: { status: "ACTIVE", creditedAt: new Date() },
    });

    const plan = await db.purchase.findUnique({ where: { chargeId: active.id } });

    await db.shopSettings.update({
      where: { shop },
      data: {
        subscriptionActive: true,
        subscriptionChargeId: active.id,
        subscriptionPlan: plan?.planId ?? null,
      },
    });
  } else {
    // No active subscription. A merchant whose subscription lapsed must not keep
    // the features it paid for — but their gateway settings are left alone, so
    // resubscribing restores everything rather than making them retype it.
    await db.shopSettings.updateMany({
      where: { shop, subscriptionActive: true },
      data: { subscriptionActive: false },
    });
  }

  return {
    granted,
    subscriptionActive: Boolean(active),
  };
}

/** Cancel the active subscription. */
export async function cancelSubscription(admin, shop) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (!settings?.subscriptionChargeId) {
    return { ok: false, error: "There is no active subscription to cancel." };
  }

  const response = await admin.graphql(SUBSCRIPTION_CANCEL, {
    variables: { id: settings.subscriptionChargeId },
  });

  const body = await response.json();
  const result = body?.data?.appSubscriptionCancel;
  const error = firstError(result?.userErrors);

  if (error) return { ok: false, error };

  await db.purchase.updateMany({
    where: { chargeId: settings.subscriptionChargeId },
    data: { status: "CANCELLED" },
  });

  await db.shopSettings.update({
    where: { shop },
    data: { subscriptionActive: false, subscriptionChargeId: null },
  });

  return { ok: true };
}
