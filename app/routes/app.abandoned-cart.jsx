import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function AbandonedCart() {
  return (
    <s-page heading="Abandoned Cart">
      <s-section heading="Abandoned checkouts">
        <s-paragraph>
          Win back customers who reached checkout but did not order.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
