import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { STATUS_LABEL, STATUS_TONE, describeSegment } from "../lib/campaigns";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const campaigns = await db.campaign.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return {
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      segment: describeSegment(campaign.segment),
      recipients: campaign.recipientCount,
      sent: campaign.sentCount,
      delivered: campaign.deliveredCount,
      failed: campaign.failedCount,
      credits: campaign.creditsUsed,
      scheduledFor: campaign.scheduledFor
        ? campaign.scheduledFor.toLocaleString("en-US", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })
        : null,
    })),
  };
};

export default function Campaigns() {
  const { campaigns } = useLoaderData();

  return (
    <s-page heading="Campaigns">
      <s-button slot="primary-action" variant="primary" href="/app/campaigns/new">
        Create campaign
      </s-button>

      <s-section heading="All campaigns">
        {campaigns.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              You have not created any campaigns yet. A campaign sends one message
              to a segment of your customers — only those who accepted SMS
              marketing.
            </s-paragraph>
            <s-button variant="primary" href="/app/campaigns/new">
              Create your first campaign
            </s-button>
          </s-stack>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Campaign</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Recipients</s-table-header>
              <s-table-header>Sent</s-table-header>
              <s-table-header>Failed</s-table-header>
              <s-table-header>Credits</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {campaigns.map((campaign) => (
                <s-table-row key={campaign.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-500">
                      <s-link href={`/app/campaigns/${campaign.id}`}>
                        {campaign.name}
                      </s-link>
                      <s-text color="subdued">
                        {campaign.segment}
                        {campaign.scheduledFor
                          ? ` · Scheduled for ${campaign.scheduledFor}`
                          : ""}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[campaign.status]}>
                      {STATUS_LABEL[campaign.status]}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {campaign.recipients.toLocaleString()}
                  </s-table-cell>
                  <s-table-cell>{campaign.sent.toLocaleString()}</s-table-cell>
                  <s-table-cell>
                    {campaign.failed > 0 ? (
                      <s-text tone="critical">{campaign.failed}</s-text>
                    ) : (
                      <s-text color="subdued">—</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>{campaign.credits.toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
