import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function NewCampaign() {
  return (
    <s-page heading="Create campaign">
      <s-link slot="breadcrumb-actions" href="/app/campaigns">
        Campaigns
      </s-link>

      <s-section heading="Campaign details">
        <s-paragraph>
          Choose an audience, write the message, then send now or schedule.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
