import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { downloadCsv, toCsv } from "../lib/csv";
import { PAGE_SIZE, STATUSES, STATUS_TONE, TYPES, TYPE_LABEL } from "../lib/logs";
import { queryLogs } from "../lib/logs.server";
import { formatBdPhone } from "../lib/phone";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

  // Filtering and paging happen in MySQL, not the browser. A merchant with
  // 80,000 log rows cannot have them all shipped to the page.
  const result = await queryLogs(session.shop, url.searchParams, { page });

  return {
    total: result.total,
    credits: result.credits,
    failed: result.failed,
    page: result.page,
    pages: result.pages,
    rows: result.rows.map((row) => ({
      id: row.id,
      date: row.createdAt.toISOString().slice(0, 10),
      time: row.createdAt.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }),
      name: row.customerName ?? "Unknown",
      phone: row.phone,
      type: row.type,
      message: row.body,
      credits: row.credits,
      charged:
        row.status === "SENT" ||
        row.status === "DELIVERED" ||
        row.status === "UNDELIVERED",
      status: row.status,
      gateway: row.provider,
      error: row.errorMessage,
    })),
  };
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
  const [params, setParams] = useSearchParams();
  const exporter = useFetcher();

  const [search, setSearch] = useState(params.get("q") ?? "");

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page"); // a new filter starts at page 1
    setParams(next);
  };

  const goToPage = (page) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    setParams(next);
  };

  const clearFilters = () => {
    setSearch("");
    setParams(new URLSearchParams());
  };

  const hasFilters = [...params.keys()].some((key) => key !== "page");

  // The export must cover every matching row, not just the 50 on screen — so it
  // is fetched from the server with the same filters rather than built from what
  // this page happens to be showing.
  const exportCsv = () => {
    const query = new URLSearchParams(params);
    query.delete("page");
    exporter.load(`/app/logs/export?${query.toString()}`);
  };

  useEffect(() => {
    if (exporter.state === "idle" && exporter.data?.rows?.length) {
      downloadCsv(
        `bd-sms-log-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(CSV_COLUMNS, exporter.data.rows),
      );
      // Clear it, or the same file downloads again on the next render.
      exporter.data.rows = null;
    }
  }, [exporter.state, exporter.data]);

  return (
    <s-page heading="SMS Log">
      <s-button
        slot="primary-action"
        onClick={exportCsv}
        {...(data.total === 0 ? { disabled: true } : {})}
        {...(exporter.state !== "idle" ? { loading: true } : {})}
      >
        Export {data.total > 0 ? `${data.total.toLocaleString()} rows` : ""} to CSV
      </s-button>

      <s-section heading="Filters">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
            <s-search-field
              label="Search"
              placeholder="Name or phone number"
              value={search}
              onInput={(event) => setSearch(event.target.value)}
              onChange={(event) => setParam("q", event.target.value)}
            />

            <s-select
              label="Type"
              value={params.get("type") ?? ""}
              onChange={(event) => setParam("type", event.target.value)}
            >
              <s-option value="">All types</s-option>
              {TYPES.map((type) => (
                <s-option key={type.value} value={type.value}>
                  {type.label}
                </s-option>
              ))}
            </s-select>

            <s-select
              label="Status"
              value={params.get("status") ?? ""}
              onChange={(event) => setParam("status", event.target.value)}
            >
              <s-option value="">All statuses</s-option>
              {STATUSES.map((status) => (
                <s-option key={status.value} value={status.value}>
                  {status.label}
                </s-option>
              ))}
            </s-select>

            <s-date-field
              label="From"
              value={params.get("from") ?? ""}
              onChange={(event) => setParam("from", event.target.value)}
            />

            <s-date-field
              label="To"
              value={params.get("to") ?? ""}
              onChange={(event) => setParam("to", event.target.value)}
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
                {data.total.toLocaleString()}{" "}
                {data.total === 1 ? "message" : "messages"} ·{" "}
                {data.credits.toLocaleString()} credits
              </s-text>
              {data.failed > 0 ? (
                <s-badge tone="critical">{data.failed} failed</s-badge>
              ) : null}
            </s-stack>

            {hasFilters ? (
              <s-button onClick={clearFilters}>Clear filters</s-button>
            ) : null}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Messages">
        {data.rows.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {hasFilters
                ? "No messages match these filters."
                : "No messages yet. Turn on an automation in Settings, or send one from Send SMS."}
            </s-paragraph>
            {hasFilters ? (
              <s-button onClick={clearFilters}>Clear filters</s-button>
            ) : null}
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
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
                {data.rows.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-500">
                        <s-text>{row.date}</s-text>
                        <s-text color="subdued">{row.time}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-500">
                        <s-text>{row.name}</s-text>
                        <s-text color="subdued">{formatBdPhone(row.phone)}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{TYPE_LABEL[row.type] ?? row.type}</s-table-cell>
                    <s-table-cell>
                      <s-text>{row.message}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      {/* A skipped or failed message was never charged. Showing
                          its would-be price in the Credits column reads as a
                          charge the merchant did not incur. */}
                      {row.charged ? (
                        row.credits
                      ) : (
                        <s-text color="subdued">—</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-500">
                        <s-badge tone={STATUS_TONE[row.status]}>{row.status}</s-badge>
                        {row.error ? (
                          <s-text color="subdued" tone="critical">
                            {row.error}
                          </s-text>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{row.gateway}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>

            {data.pages > 1 ? (
              <s-stack
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="center"
              >
                <s-button
                  {...(data.page <= 1 ? { disabled: true } : {})}
                  onClick={() => goToPage(data.page - 1)}
                >
                  Previous
                </s-button>
                <s-text color="subdued">
                  Page {data.page} of {data.pages}
                </s-text>
                <s-button
                  {...(data.page >= data.pages ? { disabled: true } : {})}
                  onClick={() => goToPage(data.page + 1)}
                >
                  Next
                </s-button>
              </s-stack>
            ) : null}

            <s-text color="subdued">
              Showing {data.rows.length} of {data.total.toLocaleString()} ·{" "}
              {PAGE_SIZE} per page
            </s-text>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
