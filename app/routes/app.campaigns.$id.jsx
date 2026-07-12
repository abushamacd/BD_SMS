import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProgressBar } from "../components/ProgressBar";
import {
  RECIPIENT_TONE,
  STATUS_TONE,
  campaignRecipients,
  campaigns,
} from "../mock/campaigns";

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);

  const campaign = campaigns.find((entry) => entry.id === params.id);

  if (!campaign) {
    throw new Response("Campaign not found", { status: 404 });
  }

  return { campaign, recipients: campaignRecipients };
};

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

export default function CampaignDetail() {
  const { campaign, recipients } = useLoaderData();

  const isRunning = campaign.status === "sending";
  const isPaused = campaign.status === "paused";
  const isScheduled = campaign.status === "scheduled";
  const isFinished = campaign.status === "completed";
  const canCancel = isRunning || isPaused || isScheduled;

  const deliveryRate =
    campaign.sent > 0
      ? `${((campaign.delivered / campaign.sent) * 100).toFixed(1)}%`
      : "—";

  const remaining = campaign.recipients - campaign.sent;

  return (
    <s-page heading={campaign.name} subheading={campaign.segment}>
      <s-link slot="breadcrumb-actions" href="/app/campaigns">
        Campaigns
      </s-link>

      {isRunning ? (
        <s-button slot="primary-action" variant="primary">
          Pause
        </s-button>
      ) : null}

      {isPaused ? (
        <s-button slot="primary-action" variant="primary">
          Resume
        </s-button>
      ) : null}

      {canCancel ? (
        <s-button slot="secondary-actions" tone="critical">
          Cancel campaign
        </s-button>
      ) : null}

      <s-banner tone="info" heading="Preview mode">
        <s-paragraph>
          Pause, resume and cancel are wired to the job queue in Phase 4. The
          numbers below are sample data.
        </s-paragraph>
      </s-banner>

      {isPaused ? (
        <s-banner tone="warning" heading="This campaign is paused">
          <s-paragraph>
            {remaining.toLocaleString()} customers have not been messaged yet.
            Credits are only spent on messages that are actually sent, so pausing
            costs you nothing.
          </s-paragraph>
        </s-banner>
      ) : null}

      {isScheduled ? (
        <s-banner tone="info" heading={`Scheduled for ${campaign.scheduledFor}`}>
          <s-paragraph>
            The audience is recalculated when the campaign starts, so customers
            who opt out before then will not be messaged.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Progress">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</s-badge>
            <s-text color="subdued">Created {campaign.createdAt}</s-text>
          </s-stack>

          <ProgressBar
            value={campaign.sent}
            total={campaign.recipients}
            tone={isFinished ? "success" : isPaused ? "warning" : "accent"}
          />

          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
            gap="base"
          >
            <StatTile
              label="Recipients"
              value={campaign.recipients.toLocaleString()}
            />
            <StatTile label="Sent" value={campaign.sent.toLocaleString()} />
            <StatTile
              label="Delivered"
              value={campaign.delivered.toLocaleString()}
              caption={deliveryRate}
            />
            <StatTile
              label="Failed"
              value={campaign.failed.toLocaleString()}
              caption={campaign.failed > 0 ? "Credits not refunded" : undefined}
            />
            <StatTile
              label="Credits used"
              value={campaign.credits.toLocaleString()}
            />
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Recipients">
        <s-table variant="auto">
          <s-table-header-row>
            <s-table-header>Customer</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Credits</s-table-header>
            <s-table-header>Sent</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {recipients.map((recipient) => (
              <s-table-row key={recipient.id}>
                <s-table-cell>
                  <s-stack direction="block" gap="small-500">
                    <s-text>{recipient.name}</s-text>
                    <s-text color="subdued">{recipient.phone}</s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>
                  <s-stack direction="block" gap="small-500">
                    <s-badge tone={RECIPIENT_TONE[recipient.status]}>
                      {recipient.status}
                    </s-badge>
                    {recipient.error ? (
                      <s-text color="subdued">{recipient.error}</s-text>
                    ) : null}
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{recipient.credits}</s-table-cell>
                <s-table-cell>{recipient.sentAt ?? "—"}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}
