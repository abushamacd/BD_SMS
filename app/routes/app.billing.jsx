import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  CREDIT_PACKAGES,
  PLANS,
  getPackage,
  getPlan,
  perCredit,
} from "../lib/billing/plans";
import {
  billingReturnUrl,
  cancelSubscription,
  isTestBilling,
  reconcileBilling,
  startCreditPurchase,
  startSubscription,
} from "../lib/billing/shopify.server";
import { getSettings } from "../lib/settings.server";

const PURCHASE_TONE = {
  PENDING: "info",
  ACTIVE: "success",
  DECLINED: "critical",
  EXPIRED: "neutral",
  CANCELLED: "neutral",
};

const PURCHASE_LABEL = {
  PENDING: "Awaiting approval",
  ACTIVE: "Paid",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Settle up with Shopify on every load.
  //
  // This is what actually grants credits — NOT the merchant arriving back at this
  // URL. A merchant who approves a charge and then closes the tab has still paid,
  // and gets their credits the next time they open this page. A merchant who
  // opens this URL without paying gets nothing, because Shopify says the charge
  // is not ACTIVE.
  let reconcileError = null;

  try {
    await reconcileBilling(admin, shop);
  } catch (error) {
    // A billing API hiccup must not take the page down — the merchant still needs
    // to see their balance and history.
    console.error("[billing] reconcile failed:", error);
    reconcileError = "Could not check your latest payments with Shopify. Your balance may be out of date.";
  }

  const [settings, purchases] = await Promise.all([
    getSettings(shop),
    db.purchase.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    gatewayMode: settings.gatewayMode,
    balance: settings.creditBalance,
    lowBalanceThreshold: settings.lowBalanceThreshold,
    lowBalanceAlerts: settings.autoRechargeEnabled,
    subscription: {
      active: settings.subscriptionActive,
      planId: settings.subscriptionPlan,
    },
    testBilling: isTestBilling(),
    reconcileError,
    purchases: purchases.map((purchase) => ({
      id: purchase.id,
      date: purchase.createdAt.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      description: purchase.name,
      credits: purchase.credits,
      amount: Number(purchase.amount),
      status: purchase.status,
      test: purchase.test,
    })),
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "buy") {
    // The browser picks WHICH package. It does not get to say what it costs —
    // the price is read from the registry on the server.
    const result = await startCreditPurchase(
      admin,
      shop,
      String(form.get("packageId")),
      billingReturnUrl(request),
    );

    return result.ok
      ? { intent: "buy", ok: true, confirmationUrl: result.confirmationUrl }
      : { intent: "buy", ok: false, message: result.error };
  }

  if (intent === "subscribe") {
    const result = await startSubscription(
      admin,
      shop,
      String(form.get("planId")),
      billingReturnUrl(request),
    );

    return result.ok
      ? { intent: "subscribe", ok: true, confirmationUrl: result.confirmationUrl }
      : { intent: "subscribe", ok: false, message: result.error };
  }

  if (intent === "cancel") {
    const result = await cancelSubscription(admin, shop);

    return {
      intent: "cancel",
      ok: result.ok,
      message: result.ok
        ? "Your subscription has been cancelled."
        : result.error,
    };
  }

  if (intent === "alerts") {
    await db.shopSettings.update({
      where: { shop },
      data: {
        autoRechargeEnabled: form.get("lowBalanceAlerts") === "true",
        lowBalanceThreshold: Math.max(
          0,
          Number(form.get("lowBalanceThreshold") ?? 500),
        ),
      },
    });

    return { intent: "alerts", ok: true, message: "Saved." };
  }

  return { ok: false, message: `Unknown action: ${intent}` };
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const perCreditUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 4,
});

function CreditsView({ data, charge, busy }) {
  const alerts = useFetcher();

  const [selected, setSelected] = useState("pkg_5k");
  const [enabled, setEnabled] = useState(data.lowBalanceAlerts);
  const [threshold, setThreshold] = useState(String(data.lowBalanceThreshold));

  const pkg = getPackage(selected);
  const isLow = data.balance < data.lowBalanceThreshold;

  const saveAlerts = () => {
    const form = new FormData();
    form.set("intent", "alerts");
    form.set("lowBalanceAlerts", String(enabled));
    form.set("lowBalanceThreshold", threshold);
    alerts.submit(form, { method: "post" });
  };

  return (
    <>
      <s-section heading="Credit balance">
        <s-stack direction="block" gap="small-200">
          <s-text color="subdued">Available balance</s-text>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-heading>{data.balance.toLocaleString()} credits</s-heading>
            {isLow ? <s-badge tone="warning">Low</s-badge> : null}
          </s-stack>
          <s-text color="subdued">
            One credit sends one SMS part. Bangla messages use more parts than
            English, so the same text can cost more.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Buy credits">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            {CREDIT_PACKAGES.map((entry) => {
              const isSelected = entry.id === selected;

              return (
                <s-clickable
                  key={entry.id}
                  onClick={() => setSelected(entry.id)}
                  padding="base"
                  borderRadius="base"
                  border={isSelected ? "base strong" : "base"}
                  background={isSelected ? "subdued" : "transparent"}
                >
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-text type="strong">
                        {entry.credits.toLocaleString()} credits
                      </s-text>
                      {entry.popular ? <s-badge tone="success">Popular</s-badge> : null}
                    </s-stack>

                    <s-heading>{usd.format(entry.price)}</s-heading>

                    <s-text color="subdued">
                      {perCreditUsd.format(perCredit(entry))} per credit
                      {entry.save ? ` · save ${entry.save}` : ""}
                    </s-text>
                  </s-stack>
                </s-clickable>
              );
            })}
          </s-grid>

          <s-banner tone="info" heading="Charged in US dollars">
            <s-paragraph>
              Shopify bills Bangladeshi merchants in USD, so this charge appears on
              your Shopify invoice in dollars even though your store sells in Taka.
              You will be asked to approve it before anything is charged.
            </s-paragraph>
          </s-banner>

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button
              variant="primary"
              onClick={() => charge("buy", { packageId: selected })}
              {...(busy ? { loading: true } : {})}
            >
              Buy {pkg.credits.toLocaleString()} credits for {usd.format(pkg.price)}
            </s-button>
            <s-text color="subdued">
              Balance after purchase:{" "}
              {(data.balance + pkg.credits).toLocaleString()} credits
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Low balance alert">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Warn me when my balance runs low"
            details="Without this, order and OTP messages stop sending the moment you hit zero — usually at the worst possible time."
            checked={enabled}
            onChange={() => setEnabled((value) => !value)}
          />

          {enabled ? (
            <s-number-field
              label="Warn me below"
              value={threshold}
              details="credits"
              onInput={(event) => setThreshold(event.target.value)}
            />
          ) : null}

          {/* Said plainly, because the obvious feature here is one Shopify does
              not allow: a one-off charge ALWAYS needs the merchant to approve it
              on Shopify's own confirmation screen, so no app can quietly buy
              credits on their behalf. Promising otherwise would be a lie the
              first empty balance would expose. */}
          <s-banner tone="info" heading="Why credits cannot top up automatically">
            <s-paragraph>
              Shopify requires you to approve every one-off charge yourself, so no
              app can buy credits on your behalf without asking. This alert is the
              next best thing: it tells you before you run out.
            </s-paragraph>
          </s-banner>

          <s-stack direction="inline" gap="base">
            <s-button
              onClick={saveAlerts}
              {...(alerts.state !== "idle" ? { loading: true } : {})}
            >
              Save
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </>
  );
}

function SubscriptionView({ data, charge, busy, cancel }) {
  const active = data.subscription.active ? getPlan(data.subscription.planId) : null;

  return (
    <>
      {active ? (
        <s-section heading="Current plan">
          <s-stack
            direction="inline"
            gap="large"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="block" gap="small-200">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-heading>{active.name}</s-heading>
                <s-badge tone="success">Active</s-badge>
              </s-stack>
              <s-text color="subdued">
                {usd.format(active.price)} per month · {active.limit}
              </s-text>
              <s-text color="subdued">
                You send through your own SMS gateway, so you buy credits from your
                provider — not from us.
              </s-text>
            </s-stack>

            <s-button
              tone="critical"
              commandFor="cancel-subscription-modal"
              command="--show"
            >
              Cancel subscription
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section heading="No active subscription">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              You are set to send through your own SMS gateway, which needs an
              active subscription. Until you subscribe, no messages will be sent.
            </s-paragraph>
            <s-link href="/app/settings/gateway">
              Or switch back to our gateway and buy credits instead
            </s-link>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Plans">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
            {PLANS.map((plan) => {
              const isCurrent = active?.id === plan.id;

              return (
                <s-box
                  key={plan.id}
                  padding="base"
                  borderRadius="base"
                  border={isCurrent ? "base strong" : "base"}
                  background={isCurrent ? "subdued" : "transparent"}
                >
                  <s-stack direction="block" gap="base">
                    <s-stack direction="block" gap="small-300">
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <s-text type="strong">{plan.name}</s-text>
                        {plan.popular ? <s-badge tone="success">Popular</s-badge> : null}
                        {isCurrent ? <s-badge tone="info">Current</s-badge> : null}
                      </s-stack>
                      <s-heading>{usd.format(plan.price)}</s-heading>
                      <s-text color="subdued">per month · {plan.limit}</s-text>
                    </s-stack>

                    <s-unordered-list>
                      {plan.features.map((feature) => (
                        <s-list-item key={feature}>{feature}</s-list-item>
                      ))}
                    </s-unordered-list>

                    <s-button
                      variant={isCurrent ? "secondary" : "primary"}
                      onClick={() => charge("subscribe", { planId: plan.id })}
                      {...(busy ? { loading: true } : {})}
                      {...(isCurrent ? { disabled: true } : {})}
                    >
                      {isCurrent
                        ? "Current plan"
                        : !active
                          ? "Subscribe"
                          : plan.price > active.price
                            ? "Upgrade"
                            : "Downgrade"}
                    </s-button>
                  </s-stack>
                </s-box>
              );
            })}
          </s-grid>

          <s-banner tone="info" heading="Charged in US dollars">
            <s-paragraph>
              Shopify bills Bangladeshi merchants in USD, so your subscription
              appears on your Shopify invoice in dollars even though your store
              sells in Taka. Changing plan replaces the old one — you are never
              charged for two at once.
            </s-paragraph>
          </s-banner>
        </s-stack>
      </s-section>

      <s-modal id="cancel-subscription-modal" heading="Cancel subscription?">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Your subscription stays active until the end of the period you have
            already paid for. After that, messages will stop sending unless you
            switch back to our gateway and buy credits.
          </s-paragraph>
        </s-stack>

        <s-button slot="primary-action" tone="critical" onClick={cancel}>
          Cancel subscription
        </s-button>
        <s-button
          slot="secondary-actions"
          command="--hide"
          commandFor="cancel-subscription-modal"
        >
          Keep it
        </s-button>
      </s-modal>
    </>
  );
}

export default function Billing() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  // Shopify's confirmation screen lives in the Shopify admin, outside our iframe.
  // Redirecting inside the frame would render the approval page in a box within
  // our app, or be blocked outright — so we break out to the top window.
  useEffect(() => {
    if (result?.confirmationUrl) {
      open(result.confirmationUrl, "_top");
    }
  }, [result]);

  useEffect(() => {
    if (result?.intent === "cancel" && result.ok) {
      shopify.toast.show(result.message);
    }
    if (result?.intent === "alerts" && result.ok) {
      shopify.toast.show(result.message);
    }
  }, [result, shopify]);

  const charge = (intent, fields) => {
    const form = new FormData();
    form.set("intent", intent);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    fetcher.submit(form, { method: "post" });
  };

  const cancel = () => charge("cancel", {});

  const isDefault = data.gatewayMode === "DEFAULT";

  return (
    <s-page heading="Billing">
      {data.testBilling ? (
        <s-banner tone="warning" heading="Test billing is on">
          <s-paragraph>
            Charges go through Shopify&apos;s real confirmation screen but no money
            moves, and any credits granted are not paid for. Turn this off
            (SHOPIFY_BILLING_TEST=false) before going live.
          </s-paragraph>
        </s-banner>
      ) : null}

      {data.reconcileError ? (
        <s-banner tone="critical" heading="Could not check your payments">
          <s-paragraph>{data.reconcileError}</s-paragraph>
        </s-banner>
      ) : null}

      {result && result.ok === false ? (
        <s-banner tone="critical" heading="That did not work">
          <s-paragraph>{result.message}</s-paragraph>
        </s-banner>
      ) : null}

      {isDefault ? (
        <CreditsView data={data} charge={charge} busy={busy} />
      ) : (
        <SubscriptionView data={data} charge={charge} busy={busy} cancel={cancel} />
      )}

      <s-section heading="Purchase history">
        {data.purchases.length === 0 ? (
          <s-paragraph>
            Nothing bought yet. Purchases appear here as soon as you approve them.
          </s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Date</s-table-header>
              <s-table-header>Description</s-table-header>
              <s-table-header>Credits</s-table-header>
              <s-table-header>Amount</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.purchases.map((purchase) => (
                <s-table-row key={purchase.id}>
                  <s-table-cell>{purchase.date}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-500">
                      <s-text>{purchase.description}</s-text>
                      {purchase.test ? (
                        <s-text color="subdued">Test charge — not paid</s-text>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {purchase.credits > 0 ? (
                      purchase.credits.toLocaleString()
                    ) : (
                      <s-text color="subdued">—</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>{usd.format(purchase.amount)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={PURCHASE_TONE[purchase.status]}>
                      {PURCHASE_LABEL[purchase.status]}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="How billing works">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-300">
            <s-text type="strong">
              {isDefault ? "You use our gateway" : "You use your own gateway"}
            </s-text>
            <s-text color="subdued">
              {isDefault
                ? "You buy SMS credits from us and we deliver your messages. No monthly fee — you only pay for what you send."
                : "You bring your own SMS gateway and buy credits from that provider. You pay us a monthly subscription for the app itself."}
            </s-text>
          </s-stack>

          <s-divider />

          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">
              {isDefault
                ? "Sending a lot? Your own gateway can be cheaper per SMS."
                : "Sending occasionally? Buying credits from us avoids a monthly fee."}
            </s-text>
            <s-link href="/app/settings/gateway">Change gateway</s-link>
          </s-stack>

          <s-divider />

          <s-text color="subdued">
            All charges go through Shopify and appear on your regular Shopify
            invoice. Credits are only added once Shopify confirms you approved the
            charge.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
