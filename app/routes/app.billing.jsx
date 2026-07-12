import { useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  CREDIT_PACKAGES,
  PLANS,
  PURCHASE_TONE,
  autoRecharge,
  balance,
  currentPlan,
  gatewayMode,
  purchases,
} from "../mock/billing";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Phase 1: mock data. Phase 5 reads the real subscription + credit ledger.
  return {
    gatewayMode,
    balance,
    packages: CREDIT_PACKAGES,
    plans: PLANS,
    currentPlan,
    autoRecharge,
    purchases,
  };
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function RechargeView({ data, recharge, setRecharge }) {
  const [selected, setSelected] = useState("pkg_5k");
  const selectedPackage = data.packages.find((pkg) => pkg.id === selected);
  const isLow = data.balance < 500;

  return (
    <>
      <s-section heading="Credit balance">
        <s-stack
          direction="inline"
          gap="large"
          alignItems="center"
          justifyContent="space-between"
        >
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
        </s-stack>
      </s-section>

      <s-section heading="Buy credits">
        <s-stack direction="block" gap="base">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
            gap="base"
          >
            {data.packages.map((pkg) => {
              const isSelected = pkg.id === selected;

              return (
                <s-clickable
                  key={pkg.id}
                  onClick={() => setSelected(pkg.id)}
                  padding="base"
                  borderRadius="base"
                  border={isSelected ? "base strong" : "base"}
                  background={isSelected ? "subdued" : "transparent"}
                >
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-text type="strong">
                        {pkg.credits.toLocaleString()} credits
                      </s-text>
                      {pkg.popular ? (
                        <s-badge tone="success">Popular</s-badge>
                      ) : null}
                    </s-stack>

                    <s-heading>{usd.format(pkg.price)}</s-heading>

                    <s-text color="subdued">
                      {usd.format(pkg.perCredit)} per credit
                      {pkg.save ? ` · save ${pkg.save}` : ""}
                    </s-text>
                  </s-stack>
                </s-clickable>
              );
            })}
          </s-grid>

          <s-banner tone="info" heading="Charged in US dollars">
            <s-paragraph>
              Shopify bills Bangladeshi merchants in USD, so this charge appears
              on your Shopify invoice in dollars even though your store sells in
              Taka.
            </s-paragraph>
          </s-banner>

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button variant="primary">
              Buy {selectedPackage.credits.toLocaleString()} credits for{" "}
              {usd.format(selectedPackage.price)}
            </s-button>
            <s-text color="subdued">
              Balance after purchase:{" "}
              {(data.balance + selectedPackage.credits).toLocaleString()} credits
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Auto-recharge">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Buy credits automatically when my balance runs low"
            details="Without this, order and OTP messages stop sending the moment you hit zero — usually at the worst possible time."
            checked={recharge.enabled}
            onChange={() =>
              setRecharge((prev) => ({ ...prev, enabled: !prev.enabled }))
            }
          />

          {recharge.enabled ? (
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
              gap="base"
            >
              <s-number-field
                label="When balance drops below"
                value={String(recharge.threshold)}
                details="credits"
                onInput={(event) =>
                  setRecharge((prev) => ({
                    ...prev,
                    threshold: Number(event.target.value) || 0,
                  }))
                }
              />

              <s-select
                label="Buy this package"
                value={recharge.packageId}
                onChange={(event) =>
                  setRecharge((prev) => ({
                    ...prev,
                    packageId: event.target.value,
                  }))
                }
              >
                {data.packages.map((pkg) => (
                  <s-option key={pkg.id} value={pkg.id}>
                    {`${pkg.credits.toLocaleString()} credits — ${usd.format(pkg.price)}`}
                  </s-option>
                ))}
              </s-select>
            </s-grid>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Purchase history">
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
                <s-table-cell>{purchase.description}</s-table-cell>
                <s-table-cell>{purchase.credits.toLocaleString()}</s-table-cell>
                <s-table-cell>{usd.format(purchase.amount)}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={PURCHASE_TONE[purchase.status]}>
                    {purchase.status}
                  </s-badge>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </>
  );
}

function SubscriptionView({ data }) {
  const active = data.plans.find((plan) => plan.id === data.currentPlan);

  return (
    <>
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

          <s-button tone="critical">Cancel subscription</s-button>
        </s-stack>
      </s-section>

      <s-section heading="Plans">
        <s-stack direction="block" gap="base">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))"
            gap="base"
          >
            {data.plans.map((plan) => {
              const isCurrent = plan.id === data.currentPlan;

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
                        {plan.popular ? (
                          <s-badge tone="success">Popular</s-badge>
                        ) : null}
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
                      {...(isCurrent ? { disabled: true } : {})}
                    >
                      {isCurrent
                        ? "Current plan"
                        : plan.price > data.plans.find((p) => p.id === data.currentPlan).price
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
              sells in Taka.
            </s-paragraph>
          </s-banner>
        </s-stack>
      </s-section>
    </>
  );
}

export default function Billing() {
  const data = useLoaderData();
  const [mode, setMode] = useState(data.gatewayMode);
  const [recharge, setRecharge] = useState(data.autoRecharge);

  const isDefault = mode === "default";

  return (
    <s-page heading="Billing">
      <s-banner tone="info" heading="Preview mode">
        <s-paragraph>
          Nothing is charged yet — the Shopify Billing API is wired up in Phase 5.
          Use the switch below to preview both billing models.
        </s-paragraph>

        <s-choice-list
          label="Preview as"
          variant="inline"
          values={[mode]}
          onChange={(event) =>
            setMode(event.target.values?.[0] ?? event.target.value)
          }
        >
          <s-choice value="default">Our gateway (buy credits)</s-choice>
          <s-choice value="personal">My own gateway (subscription)</s-choice>
        </s-choice-list>
      </s-banner>

      {isDefault ? (
        <RechargeView data={data} recharge={recharge} setRecharge={setRecharge} />
      ) : (
        <SubscriptionView data={data} />
      )}

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
            <s-link href="/app/settings">Change gateway</s-link>
          </s-stack>

          <s-divider />

          <s-text color="subdued">
            All charges go through Shopify and appear on your regular Shopify
            invoice.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
