import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function Dashboard() {
  return (
    <s-page heading="Dashboard">
      <s-section heading="BD SMS">
        <s-paragraph>
          SMS marketing and order automation for Bangladeshi merchants.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
