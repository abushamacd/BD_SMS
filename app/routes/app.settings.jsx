import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function Settings() {
  return (
    <s-page heading="Settings">
      <s-section heading="Automations">
        <s-paragraph>
          Turn each SMS automation on or off and edit its message template.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
