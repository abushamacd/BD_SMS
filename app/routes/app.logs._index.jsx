import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { downloadCsv, toCsv } from "../lib/csv";
import { STATUSES, STATUS_TONE, TYPES, TYPE_LABEL, logs } from "../mock/logs";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Phase 1: mock data. Phase 2 loads real SmsLog rows.
  return { logs };
};

const CSV_COLUMNS = [
  { key: "sentAt", label: "Date & time" },
  { key: "name", label: "Receiver name" },
  { key: "phone", label: "Phone number" },
  { key: "typeLabel", label: "Type" },
  { key: "message", label: "Message" },
  { key: "credits", label: "Credits used" },
  { key: "status", label: "Status" },
  { key: "gateway", label: "Gateway" },
  { key: "error", label: "Error" },
];

export default function SmsLog() {
  const data = useLoaderData();

  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return data.logs.filter((log) => {
      if (type !== "all" && log.type !== type) return false;
      if (status !== "all" && log.status !== status) return false;
      if (from && log.date < from) return false;
      if (to && log.date > to) return false;
      if (
        term &&
        !log.phone.includes(term) &&
        !log.name.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [data.logs, search, type, status, from, to]);

  const creditsUsed = filtered.reduce((sum, log) => sum + log.credits, 0);
  const failedCount = filtered.filter((log) => log.status === "failed").length;

  const hasFilters =
    search || type !== "all" || status !== "all" || from || to;

  const clearFilters = () => {
    setSearch("");
    setType("all");
    setStatus("all");
    setFrom("");
    setTo("");
  };

  const exportCsv = () => {
    const rows = filtered.map((log) => ({
      ...log,
      sentAt: `${log.date} ${log.time}`,
      typeLabel: TYPE_LABEL[log.type],
      error: log.error ?? "",
    }));

    downloadCsv(`bd-sms-log-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(CSV_COLUMNS, rows));
  };

  return (
    <s-page heading="SMS Log">
      <s-button
        slot="primary-action"
        onClick={exportCsv}
        {...(filtered.length === 0 ? { disabled: true } : {})}
      >
        Export {filtered.length > 0 ? `${filtered.length} rows` : ""} to CSV
      </s-button>

      <s-section heading="Filters">
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
              label="Type"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <s-option value="all">All types</s-option>
              {TYPES.map((option) => (
                <s-option key={option.value} value={option.value}>
                  {option.label}
                </s-option>
              ))}
            </s-select>

            <s-select
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <s-option value="all">All statuses</s-option>
              {STATUSES.map((option) => (
                <s-option key={option.value} value={option.value}>
                  {option.label}
                </s-option>
              ))}
            </s-select>

            <s-date-field
              label="From"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />

            <s-date-field
              label="To"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </s-grid>

          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-text color="subdued">
                {filtered.length} of {data.logs.length} messages ·{" "}
                {creditsUsed.toLocaleString()} credits
              </s-text>
              {failedCount > 0 ? (
                <s-badge tone="critical">{failedCount} failed</s-badge>
              ) : null}
            </s-stack>

            {hasFilters ? (
              <s-button onClick={clearFilters}>Clear filters</s-button>
            ) : null}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Messages">
        {filtered.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No messages match these filters.</s-paragraph>
            <s-button onClick={clearFilters}>Clear filters</s-button>
          </s-stack>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Date &amp; time</s-table-header>
              <s-table-header>Receiver</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Message</s-table-header>
              <s-table-header>Credits</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Gateway</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {filtered.map((log) => (
                <s-table-row key={log.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-500">
                      <s-text>{log.date}</s-text>
                      <s-text color="subdued">{log.time}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-500">
                      <s-text>{log.name}</s-text>
                      <s-text color="subdued">{log.phone}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{TYPE_LABEL[log.type]}</s-table-cell>
                  <s-table-cell>
                    <s-text>{log.message}</s-text>
                  </s-table-cell>
                  <s-table-cell>{log.credits}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-500">
                      <s-badge tone={STATUS_TONE[log.status]}>{log.status}</s-badge>
                      {log.error ? (
                        <s-text color="subdued" tone="critical">
                          {log.error}
                        </s-text>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{log.gateway}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
