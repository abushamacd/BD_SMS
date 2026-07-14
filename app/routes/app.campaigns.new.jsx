import { useState } from "react";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { CreditCounter } from "../components/CreditCounter";
import db from "../db.server";
import { ORDER_OPTIONS, RECENCY_OPTIONS, SEGMENTS } from "../lib/campaigns";
import { startCampaign } from "../lib/campaigns/run.server";
import { getSettings } from "../lib/settings.server";
import { MAX_PARTS, segmentSms } from "../lib/sms-credits";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  const settings = await getSettings(session.shop);

  // Tags for the picker. Cheap — the first page of customers is enough to offer
  // the tags a merchant actually uses.
  let tags = [];
  try {
    const response = await admin.graphql(`#graphql
      query CustomerTags { shop { customerTags(first: 50) { edges { node } } } }
    `);
    const body = await response.json();
    tags = (body?.data?.shop?.customerTags?.edges ?? []).map((edge) => edge.node);
  } catch {
    // Not fatal — the merchant can still pick another segment type.
  }

  return {
    tags,
    balance: settings.creditBalance,
    gatewayMode: settings.gatewayMode,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();

  const name = String(form.get("name") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const segmentType = String(form.get("segmentType") ?? "consented");
  const segmentValue = form.get("segmentValue")
    ? String(form.get("segmentValue"))
    : null;
  const schedule = String(form.get("schedule") ?? "now");
  const sendDate = String(form.get("sendDate") ?? "");
  const sendHour = Number(form.get("sendHour") ?? 11);

  const errors = [];

  if (!name) errors.push("Give the campaign a name.");
  if (!body) errors.push("Write a message.");

  const segment = segmentSms(body);

  if (segment.parts > MAX_PARTS) {
    errors.push(
      `The message is ${segment.parts} SMS parts long — the limit is ${MAX_PARTS}.`,
    );
  }

  let scheduledFor = null;

  if (schedule === "later") {
    if (!sendDate) {
      errors.push("Pick a date to send on.");
    } else {
      scheduledFor = new Date(sendDate);
      scheduledFor.setHours(sendHour, 0, 0, 0);

      if (scheduledFor <= new Date()) {
        errors.push("The scheduled time is in the past.");
      }
    }
  }

  if (errors.length > 0) return { errors };

  const campaign = await db.campaign.create({
    data: {
      shop,
      name,
      body,
      segment: { type: segmentType, value: segmentValue },
      status: scheduledFor ? "SCHEDULED" : "SENDING",
      scheduledFor,
    },
  });

  // The audience is built by the job when the campaign starts, not now — so a
  // customer who opts out between scheduling and sending is never messaged.
  await startCampaign(shop, campaign.id, scheduledFor ?? new Date());

  return redirect(`/app/campaigns/${campaign.id}`);
};

export default function NewCampaign() {
  const { tags, balance, gatewayMode } = useLoaderData();
  const submitter = useFetcher();
  const estimator = useFetcher();

  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [segmentType, setSegmentType] = useState("consented");
  const [tag, setTag] = useState(tags[0] ?? "");
  const [minOrders, setMinOrders] = useState("3");
  const [recency, setRecency] = useState("90");
  const [schedule, setSchedule] = useState("now");
  const [sendDate, setSendDate] = useState("");
  const [sendHour, setSendHour] = useState("11");

  const segmentValue =
    segmentType === "tag" ? tag : segmentType === "orders" ? minOrders : segmentType === "recency" ? recency : null;

  const estimate = estimator.data?.ok ? estimator.data : null;
  const estimating = estimator.state !== "idle";
  const audienceCount = estimate?.count ?? null;

  const { credits: creditsEach } = segmentSms(message);
  const totalCredits = audienceCount !== null ? creditsEach * audienceCount : null;
  const usesOwnGateway = gatewayMode === "PERSONAL";
  const insufficient =
    !usesOwnGateway && totalCredits !== null && totalCredits > balance;

  const runEstimate = () => {
    const form = new FormData();
    form.set("type", segmentType);
    if (segmentValue) form.set("value", segmentValue);
    estimator.submit(form, { method: "post", action: "/app/campaigns/estimate" });
  };

  const submit = () => {
    const form = new FormData();
    form.set("name", name);
    form.set("body", message);
    form.set("segmentType", segmentType);
    if (segmentValue) form.set("segmentValue", segmentValue);
    form.set("schedule", schedule);
    form.set("sendDate", sendDate);
    form.set("sendHour", sendHour);
    submitter.submit(form, { method: "post" });
  };

  const canSend =
    name.trim() &&
    message.trim() &&
    !insufficient &&
    (schedule === "now" || sendDate);

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

      {submitter.data?.errors ? (
        <s-banner tone="critical" heading="This campaign cannot be sent yet">
          <s-unordered-list>
            {submitter.data.errors.map((error) => (
              <s-list-item key={error}>{error}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      ) : null}

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
            values={[segmentType]}
            onChange={(event) =>
              setSegmentType(event.target.values?.[0] ?? event.target.value)
            }
          >
            {SEGMENTS.map((option) => (
              <s-choice key={option.value} value={option.value} details={option.details}>
                {option.label}
              </s-choice>
            ))}
          </s-choice-list>

          {segmentType === "tag" ? (
            tags.length > 0 ? (
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
            ) : (
              <s-banner tone="info" heading="No customer tags found">
                <s-paragraph>
                  Tag some customers in Shopify first, then come back.
                </s-paragraph>
              </s-banner>
            )
          ) : null}

          {segmentType === "orders" ? (
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

          {segmentType === "recency" ? (
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
              Campaigns only go to customers who accepted SMS marketing in Shopify,
              and never to numbers on your blacklist. Order updates and OTP codes
              are transactional and are not affected by this.
            </s-paragraph>
          </s-banner>

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button
              onClick={runEstimate}
              {...(estimating ? { loading: true } : {})}
            >
              Preview audience
            </s-button>
            <s-text color="subdued">
              Checks how many customers this actually reaches.
            </s-text>
          </s-stack>

          {estimator.data && !estimator.data.ok ? (
            <s-banner tone="critical" heading="Could not load your customers">
              <s-paragraph>{estimator.data.error}</s-paragraph>
            </s-banner>
          ) : null}

          {estimate ? (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="small-300">
                <s-text color="subdued">This campaign will reach</s-text>
                <s-heading>
                  {estimate.count.toLocaleString()}{" "}
                  {estimate.count === 1 ? "customer" : "customers"}
                </s-heading>
                <s-text color="subdued">
                  {estimate.scanned.toLocaleString()} customers checked ·{" "}
                  {estimate.skippedNoConsent.toLocaleString()} without SMS consent ·{" "}
                  {estimate.skippedBadPhone.toLocaleString()} without a usable
                  Bangladeshi number
                </s-text>
                {estimate.truncated ? (
                  <s-text tone="warning">
                    Capped at 50,000 recipients — this campaign will not reach
                    everyone who matched.
                  </s-text>
                ) : null}
              </s-stack>
            </s-box>
          ) : null}
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
          <CreditCounter
            text={message}
            recipients={audienceCount ?? undefined}
            onFix={setMessage}
          />
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
            <s-stack direction="block" gap="base">
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

              <s-text color="subdued">
                The audience is recalculated when the campaign starts, so anyone who
                opts out before then will not be messaged.
              </s-text>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Cost">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">Recipients</s-text>
            <s-heading>
              {audienceCount === null ? "—" : audienceCount.toLocaleString()}
            </s-heading>
            {audienceCount === null ? (
              <s-text color="subdued">Preview the audience to see the cost.</s-text>
            ) : null}
          </s-stack>

          <s-divider />

          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">Total cost</s-text>
            <s-heading>
              {totalCredits === null
                ? "—"
                : `${totalCredits.toLocaleString()} credits`}
            </s-heading>
            <s-text color="subdued">
              {creditsEach} {creditsEach === 1 ? "credit" : "credits"} per recipient
            </s-text>
          </s-stack>

          {!usesOwnGateway ? (
            <>
              <s-divider />
              <s-stack direction="block" gap="small-300">
                <s-text color="subdued">Balance after sending</s-text>
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-heading>
                    {totalCredits === null
                      ? balance.toLocaleString()
                      : (balance - totalCredits).toLocaleString()}
                  </s-heading>
                  {insufficient ? (
                    <s-badge tone="critical">Not enough</s-badge>
                  ) : null}
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
            </>
          ) : null}
        </s-stack>
      </s-section>

      <s-modal id="confirm-campaign-modal" heading="Confirm campaign">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text type="strong">{name || "Untitled campaign"}</s-text> will be
            sent to{" "}
            <s-text type="strong">
              {audienceCount === null
                ? "everyone who matches this segment"
                : `${audienceCount.toLocaleString()} ${audienceCount === 1 ? "customer" : "customers"}`}
            </s-text>
            {schedule === "now"
              ? ", starting immediately."
              : ` on ${sendDate || "the selected date"}.`}
          </s-paragraph>

          {audienceCount === null ? (
            <s-banner tone="warning" heading="You have not previewed the audience">
              <s-paragraph>
                The exact number of recipients — and the exact cost — is worked out
                when the campaign starts. Preview the audience first if you want to
                know before you commit.
              </s-paragraph>
            </s-banner>
          ) : null}

          <s-box padding="base" background="subdued" borderRadius="base">
            <s-paragraph>{message}</s-paragraph>
          </s-box>

          <CreditCounter text={message} recipients={audienceCount ?? undefined} />
        </s-stack>

        <s-button
          slot="primary-action"
          variant="primary"
          onClick={submit}
          {...(submitter.state !== "idle" ? { loading: true } : {})}
        >
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
