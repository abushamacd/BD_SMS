import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { CreditCounter } from "../components/CreditCounter";
import { ProtectedDataBanner } from "../components/ProtectedDataBanner";
import { fetchCustomersByIds, searchCustomers } from "../lib/customers.server";
import { MAX_RECIPIENTS } from "../lib/manual";
import { formatBdPhone, parsePhoneList } from "../lib/phone";
import { getSettings } from "../lib/settings.server";
import { segmentSms } from "../lib/sms-credits";
import { sendManual } from "../lib/sms/manual.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  const url = new URL(request.url);

  const settings = await getSettings(session.shop);

  const base = {
    customers: [],
    tags: [],
    noPhone: 0,
    noConsent: 0,
    truncated: false,
    balance: settings.creditBalance,
    usesOwnGateway: settings.gatewayMode === "PERSONAL",
    protectedDataBlocked: false,
  };

  // Filtering is done by Shopify, not in the browser — a store with 40,000
  // customers cannot have them all shipped to the page to filter three of them
  // out. Consent is the exception: it is not a searchable field, so it is
  // filtered in our code after fetching.
  try {
    const [result, tags] = await Promise.all([
      searchCustomers(admin, {
        search: url.searchParams.get("q") ?? "",
        tag: url.searchParams.get("tag") ?? "",
        minOrders: url.searchParams.get("orders") ?? "0",
        consentOnly: url.searchParams.get("consent") !== "all",
      }),
      customerTags(admin),
    ]);

    return { ...base, ...result, tags };
  } catch (error) {
    // The app has not been approved to read customer data. That is an access
    // request in the Partner Dashboard, not a bug — so the page explains it
    // instead of throwing a raw GraphQL error at the merchant. Pasting numbers
    // by hand still works, and is left available.
    if (error.protectedData) return { ...base, protectedDataBlocked: true };
    throw error;
  }
};

async function customerTags(admin) {
  try {
    const response = await admin.graphql(`#graphql
      query CustomerTags { shop { customerTags(first: 50) { edges { node } } } }
    `);
    const body = await response.json();

    return (body?.data?.shop?.customerTags?.edges ?? []).map(
      (edge) => edge.node,
    );
  } catch {
    return [];
  }
}

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();

  const message = String(form.get("message") ?? "");
  const consentOverride = form.get("consentOverride") === "true";

  let recipients;

  try {
    recipients = await resolveRecipients(admin, form);
  } catch (error) {
    // Refused customer data. Nothing was queued, and the merchant is told why
    // rather than getting a stack trace.
    if (error.protectedData) return { ok: false, message: error.message };
    throw error;
  }

  const result = await sendManual({
    shop,
    recipients,
    message,
    consentOverride,
  });

  if (!result.ok) return { ok: false, message: result.reason };

  return {
    ok: true,
    message: `${result.queued} message${result.queued === 1 ? "" : "s"} queued (${result.credits.toLocaleString()} credits). They appear in the SMS Log as they send.`,
  };
};

/**
 * Who this send goes to.
 *
 * Selected customers are re-fetched from Shopify by id rather than trusting the
 * phone numbers the browser posted back — the browser is not a source of truth
 * for who gets texted.
 */
async function resolveRecipients(admin, form) {
  if (form.get("mode") === "numbers") {
    const parsed = parsePhoneList(String(form.get("phones") ?? ""));

    return parsed.valid.map((entry) => ({
      phone: entry.e164,
      name: null,
      customerId: null,
      // A pasted number carries no consent record at all, which is exactly why
      // sending to one requires the merchant to confirm they have permission.
      smsConsent: false,
    }));
  }

  const ids = String(form.get("customerIds") ?? "")
    .split(",")
    .filter(Boolean);
  const customers = await fetchCustomersByIds(admin, ids);

  return customers.map((customer) => ({
    phone: customer.phone,
    name: customer.name,
    customerId: customer.id,
    smsConsent: customer.smsConsent,
  }));
}

const ORDER_FILTERS = [
  { value: "0", label: "Any number of orders" },
  { value: "1", label: "1 or more orders" },
  { value: "3", label: "3 or more orders" },
  { value: "5", label: "5 or more orders" },
  { value: "10", label: "10 or more orders" },
];

export default function SendSms() {
  const data = useLoaderData();
  const [params, setParams] = useSearchParams();
  const sender = useFetcher();
  const shopify = useAppBridge();

  // With no access to customer data there is nothing to select, so the page opens
  // on the one mode that still works: typing the numbers in.
  const [mode, setMode] = useState(
    data.protectedDataBlocked ? "numbers" : "customers",
  );
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [phoneText, setPhoneText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [search, setSearch] = useState(params.get("q") ?? "");

  const consentOnly = params.get("consent") !== "all";
  const sending = sender.state !== "idle";
  const result = sender.data;

  useEffect(() => {
    if (result?.ok) {
      shopify.toast.show(result.message);
      setMessage("");
      setSelected(new Set());
      setPhoneText("");
      setAcknowledged(false);
    }
  }, [result, shopify]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const parsed = useMemo(() => parsePhoneList(phoneText), [phoneText]);

  const selectedCustomers = data.customers.filter((customer) =>
    selected.has(customer.id),
  );

  const recipientCount =
    mode === "customers" ? selected.size : parsed.valid.length;

  const { credits: creditsEach } = segmentSms(message);
  const totalCredits = creditsEach * recipientCount;

  // A merchant on their own gateway buys credits from their provider, so our
  // balance is not what limits them.
  const insufficient = !data.usesOwnGateway && totalCredits > data.balance;
  const tooMany = recipientCount > MAX_RECIPIENTS;

  // Consent: a manual send is a marketing message. Customers who never opted in,
  // and pasted numbers (which carry no consent record at all), are only sent to
  // if the merchant says they have permission — otherwise the send pipeline
  // skips them and records why.
  const noConsentCount =
    mode === "customers"
      ? selectedCustomers.filter((customer) => !customer.smsConsent).length
      : parsed.valid.length;

  const needsAcknowledgement = noConsentCount > 0;

  // const canSend =
  //   recipientCount > 0 &&
  //   message.trim().length > 0 &&
  //   !insufficient &&
  //   !tooMany &&
  //   (!needsAcknowledgement || acknowledged);

  const canSend =
    recipientCount > 0 &&
    message.trim().length > 0 &&
    !insufficient &&
    !tooMany;

  const allSelected =
    data.customers.length > 0 &&
    data.customers.every((customer) => selected.has(customer.id));

  const toggleCustomer = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const customer of data.customers) {
        if (allSelected) next.delete(customer.id);
        else next.add(customer.id);
      }
      return next;
    });
  };

  const send = () => {
    const form = new FormData();
    form.set("mode", mode);
    form.set("message", message);
    form.set("consentOverride", String(acknowledged));

    if (mode === "customers") {
      form.set("customerIds", [...selected].join(","));
    } else {
      form.set("phones", phoneText);
    }

    sender.submit(form, { method: "post" });
  };

  return (
    <s-page heading="Send SMS">
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor="confirm-send-modal"
        command="--show"
        {...(canSend ? {} : { disabled: true })}
      >
        Review and send
      </s-button>

      {data.protectedDataBlocked ? <ProtectedDataBanner /> : null}

      {result && !result.ok ? (
        <s-banner tone="critical" heading="Nothing was sent">
          <s-paragraph>{result.message}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Recipients">
        <s-stack direction="block" gap="base">
          <s-choice-list
            label="Send to"
            variant="inline"
            values={[mode]}
            onChange={(event) =>
              setMode(event.target.values?.[0] ?? event.target.value)
            }
          >
            <s-choice
              value="customers"
              {...(data.protectedDataBlocked
                ? {
                    disabled: true,
                    details:
                      "Unavailable until the app is approved to read customer data.",
                  }
                : {})}
            >
              Select customers
            </s-choice>
            <s-choice value="numbers">Paste phone numbers</s-choice>
          </s-choice-list>

          <s-divider />

          {mode === "customers" ? (
            <s-stack direction="block" gap="base">
              <s-grid
                gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
                gap="base"
              >
                <s-search-field
                  label="Search"
                  placeholder="Name, email or phone number"
                  value={search}
                  onInput={(event) => setSearch(event.target.value)}
                  onChange={(event) => setParam("q", event.target.value)}
                />

                <s-select
                  label="Tag"
                  value={params.get("tag") ?? ""}
                  onChange={(event) => setParam("tag", event.target.value)}
                >
                  <s-option value="">All tags</s-option>
                  {data.tags.map((name) => (
                    <s-option key={name} value={name}>
                      {name}
                    </s-option>
                  ))}
                </s-select>

                <s-select
                  label="Orders placed"
                  value={params.get("orders") ?? "0"}
                  onChange={(event) => setParam("orders", event.target.value)}
                >
                  {ORDER_FILTERS.map((filter) => (
                    <s-option key={filter.value} value={filter.value}>
                      {filter.label}
                    </s-option>
                  ))}
                </s-select>
              </s-grid>

              <s-checkbox
                label="Only customers who accepted SMS marketing"
                details="Required for marketing messages. Order updates and OTP codes are exempt."
                checked={consentOnly}
                onChange={() => setParam("consent", consentOnly ? "all" : "")}
              />

              <s-stack
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-text color="subdued">
                  {data.customers.length} matching · {selected.size} selected
                  {data.noPhone > 0
                    ? ` · ${data.noPhone} hidden (no usable phone number)`
                    : ""}
                </s-text>
                <s-button
                  {...(data.customers.length === 0 ? { disabled: true } : {})}
                  onClick={toggleAll}
                >
                  {allSelected
                    ? `Deselect all ${data.customers.length}`
                    : `Select all ${data.customers.length}`}
                </s-button>
              </s-stack>

              {data.truncated ? (
                <s-banner tone="info" heading="Showing the first 100 matches">
                  <s-paragraph>
                    Narrow the search, or use a campaign — it sends to everyone
                    who matches, not just the ones on screen.
                  </s-paragraph>
                  <s-button slot="primary-action" href="/app/campaigns/new">
                    Create a campaign
                  </s-button>
                </s-banner>
              ) : null}

              {noConsentCount > 0 ? (
                <s-banner
                  tone="warning"
                  heading="Customers without SMS consent"
                >
                  <s-paragraph>
                    {noConsentCount}{" "}
                    {noConsentCount === 1 ? "customer has" : "customers have"}{" "}
                    not agreed to receive SMS marketing. Sending marketing
                    messages to them can get your sender ID blocked and breaches
                    Shopify&apos;s requirements. Unless you confirm you have
                    permission, they are skipped and the reason is recorded in
                    the log.
                  </s-paragraph>
                </s-banner>
              ) : null}

              {data.customers.length === 0 ? (
                <s-paragraph>
                  No customers match these filters.
                  {consentOnly
                    ? " Only customers who accepted SMS marketing are shown — untick that to see the rest."
                    : ""}
                </s-paragraph>
              ) : (
                <s-table variant="auto">
                  <s-table-header-row>
                    <s-table-header>Select</s-table-header>
                    <s-table-header>Customer</s-table-header>
                    <s-table-header>Orders</s-table-header>
                    <s-table-header>Tags</s-table-header>
                    <s-table-header>SMS consent</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {data.customers.map((customer) => (
                      <s-table-row key={customer.id}>
                        <s-table-cell>
                          <s-checkbox
                            label=""
                            accessibilityLabel={`Select ${customer.name}`}
                            checked={selected.has(customer.id)}
                            onChange={() => toggleCustomer(customer.id)}
                          />
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack direction="block" gap="small-500">
                            <s-text>{customer.name}</s-text>
                            <s-text color="subdued">
                              {formatBdPhone(customer.phone)}
                            </s-text>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>{customer.orders}</s-table-cell>
                        <s-table-cell>
                          {customer.tags.join(", ") || "—"}
                        </s-table-cell>
                        <s-table-cell>
                          <s-badge
                            tone={customer.smsConsent ? "success" : "neutral"}
                          >
                            {customer.smsConsent ? "Opted in" : "No consent"}
                          </s-badge>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-stack>
          ) : (
            <s-stack direction="block" gap="base">
              <s-text-area
                label="Phone numbers"
                rows={6}
                placeholder={"01712345678\n01812345679\n+8801912345680"}
                details="One per line, or separated by commas. Bangladeshi numbers in any format."
                value={phoneText}
                onInput={(event) => setPhoneText(event.target.value)}
              />

              {phoneText.trim() ? (
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-badge tone="success">
                      {parsed.valid.length} valid
                    </s-badge>
                    {parsed.invalid.length > 0 ? (
                      <s-badge tone="critical">
                        {parsed.invalid.length} invalid
                      </s-badge>
                    ) : null}
                    {parsed.duplicates > 0 ? (
                      <s-badge tone="neutral">
                        {parsed.duplicates} duplicate
                        {parsed.duplicates === 1 ? "" : "s"} removed
                      </s-badge>
                    ) : null}
                  </s-stack>

                  {parsed.invalid.length > 0 ? (
                    <s-banner
                      tone="warning"
                      heading="Some numbers cannot be sent to"
                    >
                      <s-unordered-list>
                        {parsed.invalid.slice(0, 5).map((entry, index) => (
                          <s-list-item key={`${entry.input}-${index}`}>
                            {entry.input || "(empty)"} — {entry.reason}
                          </s-list-item>
                        ))}
                      </s-unordered-list>
                      {parsed.invalid.length > 5 ? (
                        <s-paragraph>
                          and {parsed.invalid.length - 5} more.
                        </s-paragraph>
                      ) : null}
                      <s-paragraph>
                        These are skipped. Invalid numbers still cost a credit
                        if the gateway is asked to deliver them.
                      </s-paragraph>
                    </s-banner>
                  ) : null}
                </s-stack>
              ) : null}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Message">
        <s-stack direction="block" gap="base">
          <s-text-area
            label="Message"
            rows={4}
            placeholder="Write your message. Bangla is supported."
            value={message}
            onInput={(event) => setMessage(event.target.value)}
          />

          <CreditCounter
            text={message}
            recipients={recipientCount}
            onFix={setMessage}
          />
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Cost">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">Recipients</s-text>
            <s-heading>{recipientCount.toLocaleString()}</s-heading>
          </s-stack>

          <s-divider />

          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">Total cost</s-text>
            <s-heading>{totalCredits.toLocaleString()} credits</s-heading>
            <s-text color="subdued">
              {creditsEach} {creditsEach === 1 ? "credit" : "credits"} per
              recipient
            </s-text>
          </s-stack>

          <s-divider />

          {data.usesOwnGateway ? (
            <s-text color="subdued">
              You send through your own gateway, so these messages are billed by
              your provider, not deducted from a credit balance here.
            </s-text>
          ) : (
            <s-stack direction="block" gap="small-300">
              <s-text color="subdued">Balance after sending</s-text>
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-heading>
                  {(data.balance - totalCredits).toLocaleString()}
                </s-heading>
                {insufficient ? (
                  <s-badge tone="critical">Not enough</s-badge>
                ) : null}
              </s-stack>
              <s-text color="subdued">
                You have {data.balance.toLocaleString()} credits
              </s-text>
            </s-stack>
          )}

          {tooMany ? (
            <s-banner tone="critical" heading="Too many recipients">
              <s-paragraph>
                You can send to {MAX_RECIPIENTS} people at once from here. For a
                bigger send, create a campaign — it gives you progress, pause
                and resume.
              </s-paragraph>
              <s-button slot="primary-action" href="/app/campaigns/new">
                Create a campaign
              </s-button>
            </s-banner>
          ) : null}

          {insufficient ? (
            <s-button variant="primary" href="/app/billing">
              Recharge credits
            </s-button>
          ) : null}
        </s-stack>
      </s-section>

      <s-modal id="confirm-send-modal" heading="Confirm send">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            You are about to send this message to{" "}
            <s-text type="strong">
              {recipientCount.toLocaleString()}{" "}
              {recipientCount === 1 ? "recipient" : "recipients"}
            </s-text>{" "}
            for{" "}
            <s-text type="strong">
              {totalCredits.toLocaleString()} credits
            </s-text>
            . This cannot be undone.
          </s-paragraph>

          <s-box padding="base" background="subdued" borderRadius="base">
            <s-paragraph>{message}</s-paragraph>
          </s-box>

          <CreditCounter text={message} recipients={recipientCount} />

          {needsAcknowledgement ? (
            <s-stack direction="block" gap="small">
              <s-banner
                tone="warning"
                heading={
                  mode === "numbers"
                    ? "These numbers have no consent record"
                    : "Includes customers without consent"
                }
              >
                <s-paragraph>
                  {mode === "numbers"
                    ? "Pasted numbers are not matched to a customer, so we cannot check whether they agreed to receive SMS marketing."
                    : `${noConsentCount} of these recipients have not opted in to SMS marketing.`}
                </s-paragraph>
              </s-banner>

              <s-checkbox
                label="I have permission to send marketing messages to these people"
                details="Without this they are skipped, and the reason is recorded in the SMS Log."
                checked={acknowledged}
                onChange={() => setAcknowledged((value) => !value)}
              />
            </s-stack>
          ) : null}
        </s-stack>

        <s-button
          slot="primary-action"
          variant="primary"
          onClick={send}
          {...(sending ? { loading: true } : {})}
          {...(canSend ? {} : { disabled: true })}
        >
          Send now
        </s-button>
        <s-button
          slot="secondary-actions"
          command="--hide"
          commandFor="confirm-send-modal"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
