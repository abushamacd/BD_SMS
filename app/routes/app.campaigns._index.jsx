import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { STATUS_TONE, campaigns } from "../mock/campaigns";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Phase 1: mock data. Phase 4 loads real Campaign records.
  return { campaigns };
};

export default function Campaigns() {
  const data = useLoaderData();

  const deliveryRate = (campaign) =>
    campaign.sent > 0
      ? `${((campaign.delivered / campaign.sent) * 100).toFixed(1)}%`
      : "—";

  return (
    <s-page heading="Campaigns">
      <s-button slot="primary-action" variant="primary" href="/app/campaigns/new">
        Create campaign
      </s-button>

      <s-section heading="All campaigns">
        {data.campaigns.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              You have not created any campaigns yet.
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
              <s-table-header>Delivered</s-table-header>
              <s-table-header>Credits</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.campaigns.map((campaign) => (
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
                      {campaign.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{campaign.recipients.toLocaleString()}</s-table-cell>
                  <s-table-cell>{campaign.sent.toLocaleString()}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-500">
                      <s-text>{campaign.delivered.toLocaleString()}</s-text>
                      <s-text color="subdued">{deliveryRate(campaign)}</s-text>
                    </s-stack>
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
