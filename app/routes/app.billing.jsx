import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function Billing() {
  return (
    <s-page heading="Billing">
      <s-section heading="Credits and subscription">
        <s-paragraph>
          Recharge SMS credits, or subscribe to use your own SMS gateway.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
