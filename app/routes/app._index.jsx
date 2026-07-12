import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  LOW_BALANCE_THRESHOLD,
  abandonedCart,
  automations,
  credits,
  recentActivity,
  stats,
} from "../mock/dashboard";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Phase 1: mock data. Phase 2 replaces this with real queries.
  return { credits, stats, automations, abandonedCart, recentActivity };
};

const bdt = new Intl.NumberFormat("en-BD", {
  style: "currency",
  currency: "BDT",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-US");

const STATUS_TONE = {
  delivered: "success",
  sent: "info",
  queued: "neutral",
  failed: "critical",
};

function StatTile({ label, value, caption }) {
  return (
    <s-box
      padding="base"
      borderRadius="base"
      border="base"
      background="subdued"
    >
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {caption ? <s-text color="subdued">{caption}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

export default function Dashboard() {
  const data = useLoaderData();
  const isLowBalance = data.credits.balance < LOW_BALANCE_THRESHOLD;
  const usesOwnGateway = data.credits.gatewayMode === "personal";

  const enabledCount = data.automations.filter((a) => a.enabled).length;
  const recoveryRate = data.abandonedCart.smsSent
    ? ((data.abandonedCart.recovered / data.abandonedCart.smsSent) * 100).toFixed(1)
    : "0.0";

  return (
    <s-page heading="Dashboard">
      <s-button slot="primary-action" href="/app/send">
        Send SMS
      </s-button>

      {isLowBalance && !usesOwnGateway ? (
        <s-banner tone="warning" heading="Your SMS credits are running low">
          <s-paragraph>
            You have {number.format(data.credits.balance)} credits left. Messages
            will stop sending when you reach zero — including order and OTP
            messages your customers are waiting for.
          </s-paragraph>
          <s-button slot="primary-action" href="/app/billing">
            Recharge credits
          </s-button>
        </s-banner>
      ) : null}

      <s-section heading="SMS credits">
        <s-stack
          direction="inline"
          gap="large"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">Available balance</s-text>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-heading>{number.format(data.credits.balance)} credits</s-heading>
              {isLowBalance ? <s-badge tone="warning">Low</s-badge> : null}
            </s-stack>
            <s-text color="subdued">
              {usesOwnGateway
                ? `Sending through your own gateway (${data.credits.gatewayName})`
                : `Sending through ${data.credits.gatewayName}`}
            </s-text>
          </s-stack>

          <s-button variant="primary" href="/app/billing">
            {usesOwnGateway ? "Manage subscription" : "Recharge"}
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Performance">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
          gap="base"
        >
          <StatTile label="Sent today" value={number.format(data.stats.sentToday)} />
          <StatTile
            label="Sent this month"
            value={number.format(data.stats.sentThisMonth)}
          />
          <StatTile
            label="Delivery rate"
            value={`${data.stats.deliveryRate}%`}
            caption="Confirmed by the gateway"
          />
          <StatTile
            label="Credits spent"
            value={number.format(data.stats.creditsSpentThisMonth)}
            caption="This month"
          />
        </s-grid>
      </s-section>

      <s-section heading="Abandoned cart recovery">
        <s-stack direction="block" gap="base">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
            gap="base"
          >
            <StatTile
              label="Reminders sent"
              value={number.format(data.abandonedCart.smsSent)}
            />
            <StatTile
              label="Carts recovered"
              value={number.format(data.abandonedCart.recovered)}
              caption={`${recoveryRate}% recovery rate`}
            />
            <StatTile
              label="Revenue recovered"
              value={bdt.format(data.abandonedCart.revenue)}
            />
          </s-grid>
          <s-link href="/app/abandoned-cart">View abandoned checkouts</s-link>
        </s-stack>
      </s-section>

      <s-section heading="Recent activity">
        <s-table variant="auto">
          <s-table-header-row>
            <s-table-header>Customer</s-table-header>
            <s-table-header>Type</s-table-header>
            <s-table-header>Credits</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Sent</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.recentActivity.map((row) => (
              <s-table-row key={row.id}>
                <s-table-cell>
                  <s-stack direction="block" gap="small-500">
                    <s-text>{row.customer}</s-text>
                    <s-text color="subdued">{row.phone}</s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{row.type}</s-table-cell>
                <s-table-cell>{row.credits}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={STATUS_TONE[row.status]}>{row.status}</s-badge>
                </s-table-cell>
                <s-table-cell>{row.sentAt}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        <s-link href="/app/logs">View all messages</s-link>
      </s-section>

      <s-section slot="aside" heading="Automations">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            {enabledCount} of {data.automations.length} enabled
          </s-text>

          <s-stack direction="block" gap="small">
            {data.automations.map((automation) => (
              <s-stack
                key={automation.key}
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-text>{automation.name}</s-text>
                <s-badge tone={automation.enabled ? "success" : "neutral"}>
                  {automation.enabled ? "On" : "Off"}
                </s-badge>
              </s-stack>
            ))}
          </s-stack>

          <s-link href="/app/settings">Manage automations</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}
