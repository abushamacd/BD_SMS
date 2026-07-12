import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function SendSms() {
  return (
    <s-page heading="Send SMS">
      <s-section heading="Send a message">
        <s-paragraph>
          Pick customers, write a message, preview the credit cost, and send.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
