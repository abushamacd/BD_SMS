import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function SmsLog() {
  return (
    <s-page heading="SMS Log">
      <s-section heading="Delivery history">
        <s-paragraph>
          Every message sent, with recipient, credits used and delivery status.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
