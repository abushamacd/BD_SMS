import { useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { CreditCounter } from "../components/CreditCounter";
import { fixAccidentalUnicode, renderTemplate } from "../lib/sms-credits";
import {
  DELAY_OPTIONS,
  SAMPLE_VALUES,
  STATUS_TONE,
  VARIABLES,
  checkouts,
  settings,
  stats,
} from "../mock/abandoned-cart";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Phase 1: mock data. Phase 4 loads real AbandonedCheckout records.
  return { checkouts, settings, stats };
};

const bdt = new Intl.NumberFormat("en-BD", {
  style: "currency",
  currency: "BDT",
  maximumFractionDigits: 0,
});

function StatTile({ label, value, caption }) {
  return (
    <s-box padding="base" borderRadius="base" border="base" background="subdued">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {caption ? <s-text color="subdued">{caption}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

function FollowUpCard({ followUp, index, discount, onChange }) {
  const values = {
    ...SAMPLE_VALUES,
    discount_code: discount.discountCode || SAMPLE_VALUES.discount_code,
  };
  const preview = renderTemplate(followUp.template, values);

  const update = (patch) => onChange(followUp.id, patch);

  const insertVariable = (name) => {
    const token = `{{${name}}}`;
    const needsSpace =
      followUp.template.length > 0 && !followUp.template.endsWith(" ");
    update({
      template: `${followUp.template}${needsSpace ? " " : ""}${token}`,
    });
  };

  // Offering a discount in the first message trains customers to abandon carts
  // on purpose. Worth saying out loud rather than letting merchants find out.
  const discountOnFirst = index === 0 && followUp.includeDiscount;

  return (
    <s-box padding="base" borderRadius="base" border="base">
      <s-stack direction="block" gap="base">
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-stack direction="block" gap="small-500">
            <s-text type="strong">Follow-up {index + 1}</s-text>
            <s-text color="subdued">
              {followUp.enabled
                ? DELAY_OPTIONS.find((option) => option.value === followUp.delay)
                    ?.label
                : "Not sent"}
            </s-text>
          </s-stack>
          <s-switch
            label={followUp.enabled ? "On" : "Off"}
            checked={followUp.enabled}
            onChange={() => update({ enabled: !followUp.enabled })}
          />
        </s-stack>

        {followUp.enabled ? (
          <s-stack direction="block" gap="base">
            <s-select
              label="Send"
              value={followUp.delay}
              onChange={(event) => update({ delay: event.target.value })}
            >
              {DELAY_OPTIONS.map((option) => (
                <s-option key={option.value} value={option.value}>
                  {option.label}
                </s-option>
              ))}
            </s-select>

            <s-text-area
              label="Message"
              rows={3}
              value={followUp.template}
              onInput={(event) => update({ template: event.target.value })}
            />

            <s-stack direction="block" gap="small-300">
              <s-text color="subdued">Insert a variable</s-text>
              <s-stack direction="inline" gap="small-300">
                {VARIABLES.map((name) => (
                  <s-clickable-chip key={name} onClick={() => insertVariable(name)}>
                    {`{{${name}}}`}
                  </s-clickable-chip>
                ))}
              </s-stack>
            </s-stack>

            {discount.discountEnabled ? (
              <s-checkbox
                label="Include the discount code in this message"
                checked={followUp.includeDiscount}
                onChange={() =>
                  update({ includeDiscount: !followUp.includeDiscount })
                }
              />
            ) : null}

            {discountOnFirst ? (
              <s-banner tone="caution" heading="Discounting the first reminder">
                <s-paragraph>
                  Many customers abandon a cart for reasons that have nothing to do
                  with price, and a discount in the first message gives away margin
                  you did not need to spend. Most stores get a better return by
                  reminding first and discounting only if that fails.
                </s-paragraph>
              </s-banner>
            ) : null}

            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="small-300">
                <s-text color="subdued">Preview</s-text>
                <s-paragraph>{preview}</s-paragraph>
              </s-stack>
            </s-box>

            <CreditCounter
              text={preview}
              onFix={() =>
                update({ template: fixAccidentalUnicode(followUp.template).text })
              }
            />
          </s-stack>
        ) : null}
      </s-stack>
    </s-box>
  );
}

export default function AbandonedCart() {
  const data = useLoaderData();
  const [form, setForm] = useState(data.settings);
  const [pending, setPending] = useState(null);

  const updateFollowUp = (id, patch) => {
    setForm((prev) => ({
      ...prev,
      followUps: prev.followUps.map((followUp) =>
        followUp.id === id ? { ...followUp, ...patch } : followUp,
      ),
    }));
  };

  const recoveryRate = data.stats.sent
    ? ((data.stats.recovered / data.stats.sent) * 100).toFixed(1)
    : "0.0";
  const clickRate = data.stats.sent
    ? ((data.stats.clicked / data.stats.sent) * 100).toFixed(1)
    : "0.0";

  const activeFollowUps = form.followUps.filter((followUp) => followUp.enabled).length;

  return (
    <s-page heading="Abandoned Cart">
      <s-button slot="primary-action" variant="primary">
        Save
      </s-button>

      <s-banner tone="info" heading="Preview mode">
        <s-paragraph>
          Recovery messages are not sent yet — the webhook and job queue arrive in
          Phase 4. Settings and previews are interactive.
        </s-paragraph>
      </s-banner>

      <s-section heading="Recovery performance">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <StatTile label="Reminders sent" value={data.stats.sent.toLocaleString()} />
          <StatTile
            label="Links clicked"
            value={data.stats.clicked.toLocaleString()}
            caption={`${clickRate}% of sent`}
          />
          <StatTile
            label="Carts recovered"
            value={data.stats.recovered.toLocaleString()}
            caption={`${recoveryRate}% of sent`}
          />
          <StatTile
            label="Revenue recovered"
            value={bdt.format(data.stats.revenue)}
          />
        </s-grid>
      </s-section>

      <s-section heading="Recovery messages">
        <s-stack direction="block" gap="base">
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-text color="subdued">
              {form.enabled
                ? `${activeFollowUps} of 3 follow-ups active`
                : "Abandoned cart recovery is off"}
            </s-text>
            <s-switch
              label={form.enabled ? "Enabled" : "Disabled"}
              checked={form.enabled}
              onChange={() =>
                setForm((prev) => ({ ...prev, enabled: !prev.enabled }))
              }
            />
          </s-stack>

          {form.enabled ? (
            <s-stack direction="block" gap="base">
              <s-banner tone="info" heading="Only customers who opted in are messaged">
                <s-paragraph>
                  A cart reminder is a marketing message, so it is only sent to
                  customers who accepted SMS marketing at checkout. Customers who
                  did not opt in are shown below as skipped.
                </s-paragraph>
              </s-banner>

              <s-divider />

              <s-switch
                label="Attach a discount code"
                details="A discount is the single biggest lever on recovery rate — and the most expensive one."
                checked={form.discountEnabled}
                onChange={() =>
                  setForm((prev) => ({
                    ...prev,
                    discountEnabled: !prev.discountEnabled,
                  }))
                }
              />

              {form.discountEnabled ? (
                <s-text-field
                  label="Discount code"
                  value={form.discountCode}
                  details="Create this code in Shopify first. The app inserts it as {{discount_code}}."
                  onInput={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      discountCode: event.target.value,
                    }))
                  }
                />
              ) : null}

              <s-divider />

              {form.followUps.map((followUp, index) => (
                <FollowUpCard
                  key={followUp.id}
                  followUp={followUp}
                  index={index}
                  discount={form}
                  onChange={updateFollowUp}
                />
              ))}
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Abandoned checkouts">
        <s-table variant="auto">
          <s-table-header-row>
            <s-table-header>Customer</s-table-header>
            <s-table-header>Cart value</s-table-header>
            <s-table-header>Abandoned</s-table-header>
            <s-table-header>SMS</s-table-header>
            <s-table-header>Recovered</s-table-header>
            <s-table-header>Action</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.checkouts.map((checkout) => (
              <s-table-row key={checkout.id}>
                <s-table-cell>
                  <s-stack direction="block" gap="small-500">
                    <s-text>{checkout.customer}</s-text>
                    <s-text color="subdued">{checkout.phone}</s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{bdt.format(checkout.cartValue)}</s-table-cell>
                <s-table-cell>
                  <s-stack direction="block" gap="small-500">
                    <s-text>{checkout.abandonedAgo}</s-text>
                    <s-text color="subdued">{checkout.abandonedAt}</s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>
                  <s-stack direction="block" gap="small-500">
                    <s-badge tone={STATUS_TONE[checkout.status]}>
                      {checkout.status === "skipped"
                        ? "No SMS consent"
                        : checkout.status}
                    </s-badge>
                    <s-text color="subdued">
                      {checkout.status === "skipped"
                        ? "Not messaged"
                        : checkout.nextSendIn
                          ? `${checkout.followUpsSent} sent · next in ${checkout.nextSendIn}`
                          : `${checkout.followUpsSent} sent`}
                    </s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={checkout.recovered ? "success" : "neutral"}>
                    {checkout.recovered ? "Yes" : "No"}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-button
                    commandFor="manual-send-modal"
                    command="--show"
                    onClick={() => setPending(checkout)}
                    {...(checkout.recovered || !checkout.smsConsent
                      ? { disabled: true }
                      : {})}
                  >
                    Send SMS
                  </s-button>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-modal id="manual-send-modal" heading="Send recovery SMS">
        <s-stack direction="block" gap="base">
          {pending ? (
            <>
              <s-paragraph>
                Send a recovery message to{" "}
                <s-text type="strong">{pending.customer}</s-text> ({pending.phone})
                for their {bdt.format(pending.cartValue)} cart.
              </s-paragraph>

              <s-box padding="base" background="subdued" borderRadius="base">
                <s-paragraph>
                  {renderTemplate(form.followUps[0].template, {
                    ...SAMPLE_VALUES,
                    customer_name: pending.customer,
                    cart_total: bdt.format(pending.cartValue),
                    discount_code: form.discountCode || SAMPLE_VALUES.discount_code,
                  })}
                </s-paragraph>
              </s-box>

              <CreditCounter
                text={renderTemplate(form.followUps[0].template, {
                  ...SAMPLE_VALUES,
                  customer_name: pending.customer,
                  cart_total: bdt.format(pending.cartValue),
                  discount_code: form.discountCode || SAMPLE_VALUES.discount_code,
                })}
                recipients={1}
              />
            </>
          ) : null}
        </s-stack>

        <s-button slot="primary-action" variant="primary">
          Send now
        </s-button>
        <s-button
          slot="secondary-actions"
          command="--hide"
          commandFor="manual-send-modal"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
