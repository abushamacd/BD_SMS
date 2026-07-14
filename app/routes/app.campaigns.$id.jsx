import { useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import { ProgressBar } from "../components/ProgressBar";
import db from "../db.server";
import {
  RECIPIENT_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  describeSegment,
} from "../lib/campaigns";
import {
  cancelCampaign,
  pauseCampaign,
  resumeCampaign,
} from "../lib/campaigns/run.server";
import { formatBdPhone } from "../lib/phone";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop },
  });

  if (!campaign) throw new Response("Campaign not found", { status: 404 });

  const recipients = await db.campaignRecipient.findMany({
    where: { campaignId: campaign.id },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 100,
  });

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      body: campaign.body,
      status: campaign.status,
      segment: describeSegment(campaign.segment),
      recipients: campaign.recipientCount,
      sent: campaign.sentCount,
      delivered: campaign.deliveredCount,
      failed: campaign.failedCount,
      credits: campaign.creditsUsed,
      createdAt: campaign.createdAt.toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
      scheduledFor: campaign.scheduledFor
        ? campaign.scheduledFor.toLocaleString("en-US", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })
        : null,
    },
    recipients: recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.customerName ?? "Unknown",
      phone: recipient.phone,
      status: recipient.status,
      error: recipient.error,
    })),
  };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "pause") await pauseCampaign(shop, params.id);
  if (intent === "resume") await resumeCampaign(shop, params.id);
  if (intent === "cancel") await cancelCampaign(shop, params.id);

  return { ok: true, intent };
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
  const control = useFetcher();
  const revalidator = useRevalidator();

  const isSending = campaign.status === "SENDING";
  const isPaused = campaign.status === "PAUSED";
  const isScheduled = campaign.status === "SCHEDULED";
  const isFinished =
    campaign.status === "COMPLETED" || campaign.status === "CANCELLED";
  const canCancel = isSending || isPaused || isScheduled;

  // Live progress: a sending campaign updates itself so the merchant can watch it
  // work. Polling stops the moment it is not sending, so a completed campaign
  // does not sit there hammering the server forever.
  useEffect(() => {
    if (!isSending) return undefined;

    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);

    return () => clearInterval(timer);
  }, [isSending, revalidator]);

  const remaining = campaign.recipients - campaign.sent - campaign.failed;

  const send = (intent) =>
    control.submit({ intent }, { method: "post" });

  return (
    <s-page heading={campaign.name} subheading={campaign.segment}>
      <s-link slot="breadcrumb-actions" href="/app/campaigns">
        Campaigns
      </s-link>

      {isSending ? (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => send("pause")}
          {...(control.state !== "idle" ? { loading: true } : {})}
        >
          Pause
        </s-button>
      ) : null}

      {isPaused ? (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => send("resume")}
          {...(control.state !== "idle" ? { loading: true } : {})}
        >
          Resume
        </s-button>
      ) : null}

      {canCancel ? (
        <s-button
          slot="secondary-actions"
          tone="critical"
          commandFor="cancel-modal"
          command="--show"
        >
          Cancel campaign
        </s-button>
      ) : null}

      {isPaused ? (
        <s-banner tone="warning" heading="This campaign is paused">
          <s-paragraph>
            {remaining.toLocaleString()} customers have not been messaged yet.
            Credits are only spent on messages that are actually sent, so pausing
            costs you nothing. Resume when you are ready.
          </s-paragraph>
        </s-banner>
      ) : null}

      {isScheduled ? (
        <s-banner tone="info" heading={`Scheduled for ${campaign.scheduledFor}`}>
          <s-paragraph>
            The audience is worked out when the campaign starts, so anyone who opts
            out before then will not be messaged.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Progress">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone={STATUS_TONE[campaign.status]}>
              {STATUS_LABEL[campaign.status]}
            </s-badge>
            <s-text color="subdued">Created {campaign.createdAt}</s-text>
            {isSending ? <s-spinner size="small" accessibilityLabel="Sending" /> : null}
          </s-stack>

          <ProgressBar
            value={campaign.sent + campaign.failed}
            total={campaign.recipients}
            tone={isFinished ? "success" : isPaused ? "warning" : "accent"}
          />

          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
            <StatTile
              label="Recipients"
              value={campaign.recipients.toLocaleString()}
            />
            <StatTile label="Sent" value={campaign.sent.toLocaleString()} />
            <StatTile
              label="Failed"
              value={campaign.failed.toLocaleString()}
              caption={campaign.failed > 0 ? "Credits refunded" : undefined}
            />
            <StatTile
              label="Credits used"
              value={campaign.credits.toLocaleString()}
            />
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Message">
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-paragraph>{campaign.body}</s-paragraph>
        </s-box>
      </s-section>

      <s-section heading="Recipients">
        {recipients.length === 0 ? (
          <s-paragraph>
            The audience is being worked out. Recipients appear here as soon as the
            campaign starts sending.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header>Customer</s-table-header>
                <s-table-header>Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {recipients.map((recipient) => (
                  <s-table-row key={recipient.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-500">
                        <s-text>{recipient.name}</s-text>
                        <s-text color="subdued">
                          {formatBdPhone(recipient.phone)}
                        </s-text>
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
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>

            {campaign.recipients > recipients.length ? (
              <s-text color="subdued">
                Showing {recipients.length} of{" "}
                {campaign.recipients.toLocaleString()}. Every message is in the{" "}
                <s-link href="/app/logs?type=CAMPAIGN">SMS log</s-link>.
              </s-text>
            ) : null}
          </s-stack>
        )}
      </s-section>

      <s-modal id="cancel-modal" heading="Cancel this campaign?">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {campaign.sent.toLocaleString()}{" "}
            {campaign.sent === 1 ? "message has" : "messages have"} already been
            sent and cannot be recalled. The remaining{" "}
            {remaining.toLocaleString()} will not be sent, and those credits stay in
            your balance.
          </s-paragraph>
          <s-paragraph>A cancelled campaign cannot be restarted.</s-paragraph>
        </s-stack>

        <s-button
          slot="primary-action"
          tone="critical"
          onClick={() => send("cancel")}
          command="--hide"
          commandFor="cancel-modal"
        >
          Cancel campaign
        </s-button>
        <s-button slot="secondary-actions" command="--hide" commandFor="cancel-modal">
          Keep sending
        </s-button>
      </s-modal>
    </s-page>
  );
}
