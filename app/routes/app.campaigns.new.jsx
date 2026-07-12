import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { CreditCounter } from "../components/CreditCounter";
import { segmentSms } from "../lib/sms-credits";
import { RECENCY_OPTIONS, SEGMENTS } from "../mock/campaigns";
import { CREDIT_BALANCE, TAGS, customers } from "../mock/customers";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return { customers, tags: TAGS, balance: CREDIT_BALANCE };
};

const ORDER_OPTIONS = [
  { value: "1", label: "1 or more orders" },
  { value: "3", label: "3 or more orders" },
  { value: "5", label: "5 or more orders" },
  { value: "10", label: "10 or more orders" },
];

export default function NewCampaign() {
  const { customers: allCustomers, tags, balance } = useLoaderData();

  const [name, setName] = useState("");
  const [segment, setSegment] = useState("consented");
  const [tag, setTag] = useState(tags[0]);
  const [minOrders, setMinOrders] = useState("3");
  const [recency, setRecency] = useState("90");
  const [message, setMessage] = useState("");
  const [schedule, setSchedule] = useState("now");
  const [sendDate, setSendDate] = useState("");
  const [sendHour, setSendHour] = useState("11");

  // Campaigns are marketing, so consent is not optional — every segment starts
  // from opted-in customers only. This mirrors what the backend will enforce.
  const consented = useMemo(
    () => allCustomers.filter((customer) => customer.smsConsent),
    [allCustomers],
  );

  const excludedForConsent = allCustomers.length - consented.length;

  const audience = useMemo(() => {
    switch (segment) {
      case "tag":
        return consented.filter((customer) => customer.tags.includes(tag));
      case "orders":
        return consented.filter((customer) => customer.orders >= Number(minOrders));
      case "recency":
        // Mock: the real query will compare against each customer's last order
        // date. Here we approximate with low order counts.
        return consented.filter((customer) => customer.orders <= 2);
      case "consented":
      default:
        return consented;
    }
  }, [segment, consented, tag, minOrders]);

  const { credits: creditsEach } = segmentSms(message);
  const totalCredits = creditsEach * audience.length;
  const insufficient = totalCredits > balance;

  const canSend =
    name.trim().length > 0 &&
    message.trim().length > 0 &&
    audience.length > 0 &&
    !insufficient &&
    (schedule === "now" || sendDate);

  const selectedSegment = SEGMENTS.find((option) => option.value === segment);

  return (
    <s-page heading="Create campaign">
      <s-link slot="breadcrumb-actions" href="/app/campaigns">
        Campaigns
      </s-link>

      <s-button
        slot="primary-action"
        variant="primary"
        commandFor="confirm-campaign-modal"
        command="--show"
        {...(canSend ? {} : { disabled: true })}
      >
        {schedule === "now" ? "Review and send" : "Review and schedule"}
      </s-button>

      <s-banner tone="info" heading="Preview mode">
        <s-paragraph>
          Campaigns are not saved or sent yet — that arrives in Phase 4. The
          audience estimate and cost preview are live.
        </s-paragraph>
      </s-banner>

      <s-section heading="Campaign name">
        <s-text-field
          label="Name"
          placeholder="Eid sale — 25% off"
          details="Only you see this. It identifies the campaign in your reports."
          value={name}
          onInput={(event) => setName(event.target.value)}
        />
      </s-section>

      <s-section heading="Audience">
        <s-stack direction="block" gap="base">
          <s-choice-list
            label="Who should receive this campaign?"
            values={[segment]}
            onChange={(event) =>
              setSegment(event.target.values?.[0] ?? event.target.value)
            }
          >
            {SEGMENTS.map((option) => (
              <s-choice
                key={option.value}
                value={option.value}
                details={option.details}
              >
                {option.label}
              </s-choice>
            ))}
          </s-choice-list>

          {segment === "tag" ? (
            <s-select
              label="Tag"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
            >
              {tags.map((option) => (
                <s-option key={option} value={option}>
                  {option}
                </s-option>
              ))}
            </s-select>
          ) : null}

          {segment === "orders" ? (
            <s-select
              label="Orders placed"
              value={minOrders}
              onChange={(event) => setMinOrders(event.target.value)}
            >
              {ORDER_OPTIONS.map((option) => (
                <s-option key={option.value} value={option.value}>
                  {option.label}
                </s-option>
              ))}
            </s-select>
          ) : null}

          {segment === "recency" ? (
            <s-select
              label="Last order"
              value={recency}
              onChange={(event) => setRecency(event.target.value)}
            >
              {RECENCY_OPTIONS.map((option) => (
                <s-option key={option.value} value={option.value}>
                  {option.label}
                </s-option>
              ))}
            </s-select>
          ) : null}

          <s-banner tone="info" heading="Marketing consent is required">
            <s-paragraph>
              Campaigns are only sent to customers who accepted SMS marketing in
              Shopify.{" "}
              {excludedForConsent > 0
                ? `${excludedForConsent} of your ${allCustomers.length} customers have not opted in and are excluded from every segment.`
                : "All of your customers have opted in."}{" "}
              Order updates and OTP codes are transactional and are not affected
              by this.
            </s-paragraph>
          </s-banner>

          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="small-300">
              <s-text color="subdued">Estimated audience</s-text>
              <s-heading>
                {audience.length.toLocaleString()}{" "}
                {audience.length === 1 ? "customer" : "customers"}
              </s-heading>
              <s-text color="subdued">{selectedSegment?.label}</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Message">
        <s-stack direction="block" gap="base">
          <s-text-area
            label="Message"
            rows={4}
            placeholder="Write your campaign message. Bangla is supported."
            value={message}
            onInput={(event) => setMessage(event.target.value)}
          />
          <CreditCounter text={message} recipients={audience.length} />
        </s-stack>
      </s-section>

      <s-section heading="When to send">
        <s-stack direction="block" gap="base">
          <s-choice-list
            label="Send"
            variant="inline"
            values={[schedule]}
            onChange={(event) =>
              setSchedule(event.target.values?.[0] ?? event.target.value)
            }
          >
            <s-choice value="now">Send now</s-choice>
            <s-choice value="later">Schedule for later</s-choice>
          </s-choice-list>

          {schedule === "later" ? (
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
              gap="base"
            >
              <s-date-field
                label="Date"
                value={sendDate}
                onChange={(event) => setSendDate(event.target.value)}
              />
              <s-select
                label="Time"
                value={sendHour}
                onChange={(event) => setSendHour(event.target.value)}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <s-option key={hour} value={String(hour)}>
                    {`${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? "AM" : "PM"}`}
                  </s-option>
                ))}
              </s-select>
            </s-grid>
          ) : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Cost">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">Recipients</s-text>
            <s-heading>{audience.length.toLocaleString()}</s-heading>
          </s-stack>

          <s-divider />

          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">Total cost</s-text>
            <s-heading>{totalCredits.toLocaleString()} credits</s-heading>
            <s-text color="subdued">
              {creditsEach} {creditsEach === 1 ? "credit" : "credits"} per recipient
            </s-text>
          </s-stack>

          <s-divider />

          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">Balance after sending</s-text>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-heading>{(balance - totalCredits).toLocaleString()}</s-heading>
              {insufficient ? <s-badge tone="critical">Not enough</s-badge> : null}
            </s-stack>
            <s-text color="subdued">
              You have {balance.toLocaleString()} credits
            </s-text>
          </s-stack>

          {insufficient ? (
            <s-button variant="primary" href="/app/billing">
              Recharge credits
            </s-button>
          ) : null}
        </s-stack>
      </s-section>

      <s-modal id="confirm-campaign-modal" heading="Confirm campaign">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text type="strong">{name || "Untitled campaign"}</s-text> will be
            sent to{" "}
            <s-text type="strong">
              {audience.length.toLocaleString()}{" "}
              {audience.length === 1 ? "customer" : "customers"}
            </s-text>{" "}
            for{" "}
            <s-text type="strong">{totalCredits.toLocaleString()} credits</s-text>
            {schedule === "now"
              ? ", starting immediately."
              : ` on ${sendDate || "the selected date"}.`}
          </s-paragraph>

          <s-box padding="base" background="subdued" borderRadius="base">
            <s-paragraph>{message}</s-paragraph>
          </s-box>

          <CreditCounter text={message} recipients={audience.length} />
        </s-stack>

        <s-button slot="primary-action" variant="primary">
          {schedule === "now" ? "Send campaign" : "Schedule campaign"}
        </s-button>
        <s-button
          slot="secondary-actions"
          command="--hide"
          commandFor="confirm-campaign-modal"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
