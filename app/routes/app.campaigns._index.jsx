import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function Campaigns() {
  return (
    <s-page heading="Campaigns">
      <s-button slot="primary-action" href="/app/campaigns/new">
        Create campaign
      </s-button>

      <s-section heading="All campaigns">
        <s-paragraph>
          Create, schedule and control bulk SMS campaigns.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
