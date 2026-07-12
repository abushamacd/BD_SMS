import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { CreditCounter } from "../components/CreditCounter";
import { parsePhoneList } from "../lib/phone";
import { segmentSms } from "../lib/sms-credits";
import { CREDIT_BALANCE, TAGS, customers } from "../mock/customers";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Phase 1: mock data. Phase 3 queries real customers + credit balance.
  return { customers, tags: TAGS, balance: CREDIT_BALANCE };
};

const ORDER_FILTERS = [
  { value: "0", label: "Any number of orders" },
  { value: "1", label: "1 or more orders" },
  { value: "3", label: "3 or more orders" },
  { value: "5", label: "5 or more orders" },
  { value: "10", label: "10 or more orders" },
];

export default function SendSms() {
  const { customers: allCustomers, tags, balance } = useLoaderData();

  const [mode, setMode] = useState("customers");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [phoneText, setPhoneText] = useState("");

  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("all");
  const [minOrders, setMinOrders] = useState("0");
  const [consentOnly, setConsentOnly] = useState(true);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return allCustomers.filter((customer) => {
      if (consentOnly && !customer.smsConsent) return false;
      if (tag !== "all" && !customer.tags.includes(tag)) return false;
      if (customer.orders < Number(minOrders)) return false;
      if (
        term &&
        !customer.name.toLowerCase().includes(term) &&
        !customer.phone.includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [allCustomers, search, tag, minOrders, consentOnly]);

  const parsed = useMemo(() => parsePhoneList(phoneText), [phoneText]);

  const recipientCount =
    mode === "customers" ? selected.size : parsed.valid.length;

  const { credits: creditsEach } = segmentSms(message);
  const totalCredits = creditsEach * recipientCount;
  const insufficient = totalCredits > balance;
  const canSend = recipientCount > 0 && message.trim().length > 0 && !insufficient;

  // A manual send is a marketing message, so a customer who never opted in
  // should not receive one. They can still be selected deliberately, but the
  // merchant is told what they are doing.
  const noConsentSelected = allCustomers.filter(
    (customer) => selected.has(customer.id) && !customer.smsConsent,
  ).length;

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((customer) => selected.has(customer.id));

  const toggleCustomer = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((customer) => next.delete(customer.id));
      } else {
        filtered.forEach((customer) => next.add(customer.id));
      }
      return next;
    });
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

      <s-banner tone="info" heading="Preview mode">
        <s-paragraph>
          Nothing is sent yet — the send pipeline is built in Phase 2. Selection,
          filtering and cost preview are live.
        </s-paragraph>
      </s-banner>

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
            <s-choice value="customers">Select customers</s-choice>
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
                  placeholder="Name or phone number"
                  value={search}
                  onInput={(event) => setSearch(event.target.value)}
                />

                <s-select
                  label="Tag"
                  value={tag}
                  onChange={(event) => setTag(event.target.value)}
                >
                  <s-option value="all">All tags</s-option>
                  {tags.map((name) => (
                    <s-option key={name} value={name}>
                      {name}
                    </s-option>
                  ))}
                </s-select>

                <s-select
                  label="Orders placed"
                  value={minOrders}
                  onChange={(event) => setMinOrders(event.target.value)}
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
                onChange={() => setConsentOnly((value) => !value)}
              />

              <s-stack
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-text color="subdued">
                  {filtered.length} matching · {selected.size} selected
                </s-text>
                <s-button
                  {...(filtered.length === 0 ? { disabled: true } : {})}
                  onClick={toggleAllFiltered}
                >
                  {allFilteredSelected
                    ? `Deselect all ${filtered.length}`
                    : `Select all ${filtered.length}`}
                </s-button>
              </s-stack>

              {noConsentSelected > 0 ? (
                <s-banner tone="warning" heading="Customers without SMS consent">
                  <s-paragraph>
                    {noConsentSelected}{" "}
                    {noConsentSelected === 1 ? "customer has" : "customers have"} not
                    agreed to receive SMS marketing. Sending marketing messages to
                    them can get your sender ID blocked and breaches Shopify&apos;s
                    requirements.
                  </s-paragraph>
                </s-banner>
              ) : null}

              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header>Select</s-table-header>
                  <s-table-header>Customer</s-table-header>
                  <s-table-header>Orders</s-table-header>
                  <s-table-header>Tags</s-table-header>
                  <s-table-header>SMS consent</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {filtered.map((customer) => (
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
                          <s-text color="subdued">{customer.phone}</s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>{customer.orders}</s-table-cell>
                      <s-table-cell>{customer.tags.join(", ") || "—"}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={customer.smsConsent ? "success" : "neutral"}>
                          {customer.smsConsent ? "Opted in" : "No consent"}
                        </s-badge>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>

              {filtered.length === 0 ? (
                <s-text color="subdued">No customers match these filters.</s-text>
              ) : null}
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
                    <s-badge tone="success">{parsed.valid.length} valid</s-badge>
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
                    <s-banner tone="warning" heading="Some numbers cannot be sent to">
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
                        These are skipped. Invalid numbers still cost a credit if
                        the gateway is asked to deliver them.
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

          <CreditCounter text={message} recipients={recipientCount} />
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
            <s-text color="subdued">You have {balance.toLocaleString()} credits</s-text>
          </s-stack>

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
            <s-text type="strong">{totalCredits.toLocaleString()} credits</s-text>.
            This cannot be undone.
          </s-paragraph>

          <s-box padding="base" background="subdued" borderRadius="base">
            <s-paragraph>{message}</s-paragraph>
          </s-box>

          <CreditCounter text={message} recipients={recipientCount} />

          {noConsentSelected > 0 && mode === "customers" ? (
            <s-banner tone="warning" heading="Includes customers without consent">
              <s-paragraph>
                {noConsentSelected} of these recipients have not opted in to SMS
                marketing.
              </s-paragraph>
            </s-banner>
          ) : null}
        </s-stack>

        <s-button slot="primary-action" variant="primary">
          Send now
        </s-button>
        <s-button slot="secondary-actions" command="--hide" commandFor="confirm-send-modal">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
