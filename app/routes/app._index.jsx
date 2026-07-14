import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AUTOMATIONS } from "../lib/automations";
import { STATUS_TONE, TYPE_LABEL } from "../lib/logs";
import { formatBdPhone } from "../lib/phone";
import { ensureTemplates, getSettings } from "../lib/settings.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  await ensureTemplates(shop);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // SKIPPED messages are excluded from every count. They were never sent and
  // never billed, so counting them as "sent" would overstate both the volume and
  // the delivery rate.
  const sent = { in: ["SENT", "DELIVERED"] };

  const [
    settings,
    templates,
    sentToday,
    sentThisMonth,
    deliveredThisMonth,
    creditsAgg,
    recent,
    failedThisMonth,
  ] = await Promise.all([
    getSettings(shop),
    db.messageTemplate.findMany({ where: { shop } }),
    db.smsLog.count({ where: { shop, status: sent, createdAt: { gte: startOfToday } } }),
    db.smsLog.count({ where: { shop, status: sent, createdAt: { gte: startOfMonth } } }),
    db.smsLog.count({
      where: { shop, status: "DELIVERED", createdAt: { gte: startOfMonth } },
    }),
    db.smsLog.aggregate({
      where: { shop, status: sent, createdAt: { gte: startOfMonth } },
      _sum: { credits: true },
    }),
    db.smsLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.smsLog.count({
      where: { shop, status: "FAILED", createdAt: { gte: startOfMonth } },
    }),
  ]);

  const enabledKeys = new Set(
    templates.filter((template) => template.enabled).map((template) => template.key),
  );

  return {
    credits: {
      balance: settings.creditBalance,
      threshold: settings.lowBalanceThreshold,
      gatewayMode: settings.gatewayMode,
    },
    stats: {
      sentToday,
      sentThisMonth,
      failedThisMonth,
      creditsSpentThisMonth: creditsAgg._sum.credits ?? 0,
      // Only meaningful once delivery reports exist (Phase 6). Until then every
      // message sits at SENT, so a "0% delivered" figure would be a lie — we show
      // it as unavailable instead.
      deliveryRate:
        sentThisMonth > 0 && deliveredThisMonth > 0
          ? ((deliveredThisMonth / sentThisMonth) * 100).toFixed(1)
          : null,
    },
    automations: AUTOMATIONS.map((automation) => ({
      key: automation.key,
      name: automation.name,
      enabled: enabledKeys.has(automation.key),
    })),
    recent: recent.map((row) => ({
      id: row.id,
      customer: row.customerName ?? "Unknown",
      phone: row.phone,
      type: row.type,
      credits: row.credits,
      status: row.status,
      sentAt: row.createdAt.toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    })),
  };
};

const number = new Intl.NumberFormat("en-US");

function StatTile({ label, value, caption }) {
  return (
    <s-box padding="base" borderRadius="base" border="base" background="subdued">
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

  const usesOwnGateway = data.credits.gatewayMode === "PERSONAL";
  const isLowBalance =
    !usesOwnGateway && data.credits.balance < data.credits.threshold;

  const enabledCount = data.automations.filter((a) => a.enabled).length;
  const nothingEnabled = enabledCount === 0;

  return (
    <s-page heading="Dashboard">
      <s-button slot="primary-action" href="/app/send">
        Send SMS
      </s-button>

      {nothingEnabled ? (
        <s-banner tone="info" heading="No automations are switched on yet">
          <s-paragraph>
            BD SMS does not message your customers until you turn an automation on.
            Start with the New Order SMS — you can preview the message and send
            yourself a test first.
          </s-paragraph>
          <s-button slot="primary-action" href="/app/settings">
            Set up automations
          </s-button>
        </s-banner>
      ) : null}

      {isLowBalance ? (
        <s-banner tone="warning" heading="Your SMS credits are running low">
          <s-paragraph>
            You have {number.format(data.credits.balance)} credits left. Messages
            stop sending at zero — including the order and OTP messages your
            customers are waiting for.
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
            <s-text color="subdued">
              {usesOwnGateway ? "Sending through your own gateway" : "Available balance"}
            </s-text>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-heading>
                {usesOwnGateway
                  ? "Your gateway"
                  : `${number.format(data.credits.balance)} credits`}
              </s-heading>
              {isLowBalance ? <s-badge tone="warning">Low</s-badge> : null}
            </s-stack>
            <s-text color="subdued">
              {usesOwnGateway
                ? "Your credits live with your SMS provider, not with us."
                : "One credit sends one SMS part. Bangla messages use more parts than English."}
            </s-text>
          </s-stack>

          <s-button variant="primary" href="/app/billing">
            {usesOwnGateway ? "Manage subscription" : "Recharge"}
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="This month">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <StatTile label="Sent today" value={number.format(data.stats.sentToday)} />
          <StatTile
            label="Sent this month"
            value={number.format(data.stats.sentThisMonth)}
          />
          <StatTile
            label="Delivery rate"
            value={data.stats.deliveryRate ? `${data.stats.deliveryRate}%` : "—"}
            caption={
              data.stats.deliveryRate
                ? "Confirmed by the gateway"
                : "Needs delivery reports"
            }
          />
          <StatTile
            label="Credits spent"
            value={number.format(data.stats.creditsSpentThisMonth)}
            caption={
              data.stats.failedThisMonth > 0
                ? `${data.stats.failedThisMonth} failed (refunded)`
                : undefined
            }
          />
        </s-grid>
      </s-section>

      <s-section heading="Recent activity">
        {data.recent.length === 0 ? (
          <s-paragraph>
            No messages yet. Once an automation is on, every message you send
            appears here and in the SMS log.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header>Customer</s-table-header>
                <s-table-header>Type</s-table-header>
                <s-table-header>Credits</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Sent</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.recent.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-500">
                        <s-text>{row.customer}</s-text>
                        <s-text color="subdued">{formatBdPhone(row.phone)}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{TYPE_LABEL[row.type] ?? row.type}</s-table-cell>
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
          </s-stack>
        )}
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
                <s-text>{automation.name.replace(" SMS", "")}</s-text>
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
