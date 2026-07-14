import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { SettingsNav } from "../components/SettingsNav";
import db from "../db.server";
import { PAGE_SIZE, SOURCES, SOURCE_LABEL, SOURCE_TONE } from "../lib/blacklist";
import {
  addToBlacklist,
  queryBlacklist,
  removeFromBlacklist,
} from "../lib/blacklist.server";
import { formatBdPhone, parsePhoneList } from "../lib/phone";
import { getSettings } from "../lib/settings.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

  const [result, settings] = await Promise.all([
    queryBlacklist(shop, url.searchParams, { page }),
    getSettings(shop),
  ]);

  return {
    total: result.total,
    stopCount: result.stopCount,
    allCount: result.allCount,
    page: result.page,
    pages: result.pages,
    blockTransactional: settings.blockTransactional,
    rows: result.rows.map((row) => ({
      id: row.id,
      phone: row.phone,
      name: row.name,
      source: row.source,
      note: row.note,
      addedAt: row.createdAt.toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "add") {
    const result = await addToBlacklist(shop, {
      input: String(form.get("phones") ?? ""),
      note: String(form.get("note") ?? ""),
    });

    if (result.added === 0 && result.skipped === 0) {
      return {
        intent: "add",
        ok: false,
        message: "None of those numbers could be read as a Bangladeshi number.",
      };
    }

    return {
      intent: "add",
      ok: true,
      message: [
        result.added > 0 &&
          `${result.added} number${result.added === 1 ? "" : "s"} blocked.`,
        result.skipped > 0 &&
          `${result.skipped} ${result.skipped === 1 ? "was" : "were"} already blocked.`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  if (intent === "remove") {
    const { removed } = await removeFromBlacklist(shop, String(form.get("id")));

    return {
      intent: "remove",
      ok: removed,
      message: removed ? "Number unblocked." : "That number was not on the list.",
    };
  }

  if (intent === "settings") {
    await db.shopSettings.update({
      where: { shop },
      data: { blockTransactional: form.get("blockTransactional") === "true" },
    });

    return { intent: "settings", ok: true, message: "Saved." };
  }

  return { ok: false, message: `Unknown action: ${intent}` };
};

export default function Blacklist() {
  const data = useLoaderData();
  const [params, setParams] = useSearchParams();
  const addFetcher = useFetcher();
  const removeFetcher = useFetcher();
  const settingsFetcher = useFetcher();
  const shopify = useAppBridge();

  const [search, setSearch] = useState(params.get("q") ?? "");
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");

  // The switch is optimistic: the fetcher's own value while it is in flight,
  // otherwise whatever the server last told us.
  const blockTransactional = settingsFetcher.formData
    ? settingsFetcher.formData.get("blockTransactional") === "true"
    : data.blockTransactional;

  const parsed = useMemo(() => parsePhoneList(input), [input]);

  const addResult = addFetcher.data?.intent === "add" ? addFetcher.data : null;

  useEffect(() => {
    if (addResult?.ok) {
      shopify.toast.show(addResult.message);
      setInput("");
      setNote("");
    }
  }, [addResult, shopify]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  };

  const addNumbers = () => {
    const form = new FormData();
    form.set("intent", "add");
    form.set("phones", input);
    form.set("note", note);
    addFetcher.submit(form, { method: "post" });
  };

  const removeEntry = (id) => {
    const form = new FormData();
    form.set("intent", "remove");
    form.set("id", id);
    removeFetcher.submit(form, { method: "post" });
  };

  const toggleBlockTransactional = () => {
    const form = new FormData();
    form.set("intent", "settings");
    form.set("blockTransactional", String(!blockTransactional));
    settingsFetcher.submit(form, { method: "post" });
  };

  const hasFilters = [...params.keys()].some((key) => key !== "page");

  return (
    <s-page heading="Blacklist">
      <s-section>
        <SettingsNav current="/app/settings/blacklist" />
      </s-section>

      <s-section heading="How opt-out works">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Every message is checked against this list before it is sent. A
            customer who replies <s-text type="strong">STOP</s-text> is added
            automatically, and numbers the gateway reports as undeliverable or on
            the operator DND list are added too — so you stop paying to text a
            number that will never receive anything.
          </s-paragraph>

          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone="critical">{data.stopCount} opted out</s-badge>
            <s-badge tone="neutral">{data.allCount} blocked in total</s-badge>
          </s-stack>

          <s-divider />

          <s-switch
            label="Also block order updates and OTP codes"
            details="Off by default. Opting out of marketing does not usually mean a customer wants to stop receiving the OTP that confirms their own order, or the SMS telling them it has shipped. Turn this on only if you want a blocked number to receive nothing at all."
            checked={blockTransactional}
            onChange={toggleBlockTransactional}
          />

          {blockTransactional ? (
            <s-banner
              tone="warning"
              heading="COD verification will fail for these numbers"
            >
              <s-paragraph>
                Blocked customers will not receive their COD OTP, so their orders
                can never be confirmed and will stay tagged as unverified.
              </s-paragraph>
            </s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Block a number">
        <s-stack direction="block" gap="base">
          <s-text-area
            label="Phone numbers"
            rows={3}
            placeholder={"01712345678\n01812345679"}
            details="One per line, or separated by commas. Any Bangladeshi format."
            value={input}
            onInput={(event) => setInput(event.target.value)}
          />

          <s-text-field
            label="Reason (optional)"
            placeholder="Customer asked to be removed by phone"
            value={note}
            onInput={(event) => setNote(event.target.value)}
          />

          {input.trim() ? (
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone="success">{parsed.valid.length} to block</s-badge>
              {parsed.duplicates > 0 ? (
                <s-badge tone="neutral">
                  {parsed.duplicates} duplicate
                  {parsed.duplicates === 1 ? "" : "s"} removed
                </s-badge>
              ) : null}
              {parsed.invalid.length > 0 ? (
                <s-badge tone="critical">{parsed.invalid.length} invalid</s-badge>
              ) : null}
            </s-stack>
          ) : null}

          {parsed.invalid.length > 0 ? (
            <s-banner tone="warning" heading="Some numbers are not valid">
              <s-unordered-list>
                {parsed.invalid.slice(0, 5).map((entry, index) => (
                  <s-list-item key={`${entry.input}-${index}`}>
                    {entry.input || "(empty)"} — {entry.reason}
                  </s-list-item>
                ))}
              </s-unordered-list>
            </s-banner>
          ) : null}

          {addResult && !addResult.ok ? (
            <s-banner tone="critical" heading="Nothing was blocked">
              <s-paragraph>{addResult.message}</s-paragraph>
            </s-banner>
          ) : null}

          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              onClick={addNumbers}
              {...(addFetcher.state !== "idle" ? { loading: true } : {})}
              {...(parsed.valid.length === 0 ? { disabled: true } : {})}
            >
              {parsed.valid.length > 1
                ? `Block ${parsed.valid.length} numbers`
                : "Block number"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Blocked numbers">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <s-search-field
              label="Search"
              placeholder="Name, phone number or reason"
              value={search}
              onInput={(event) => setSearch(event.target.value)}
              onChange={(event) => setParam("q", event.target.value)}
            />

            <s-select
              label="Reason"
              value={params.get("source") ?? ""}
              onChange={(event) => setParam("source", event.target.value)}
            >
              <s-option value="">All reasons</s-option>
              {SOURCES.map((option) => (
                <s-option key={option.value} value={option.value}>
                  {option.label}
                </s-option>
              ))}
            </s-select>
          </s-grid>

          {data.rows.length === 0 ? (
            <s-paragraph>
              {data.allCount === 0
                ? "No numbers are blocked. Customers who reply STOP will appear here automatically."
                : "No blocked numbers match these filters."}
            </s-paragraph>
          ) : (
            <s-stack direction="block" gap="base">
              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header>Number</s-table-header>
                  <s-table-header>Reason</s-table-header>
                  <s-table-header>Blocked</s-table-header>
                  <s-table-header>Action</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.rows.map((entry) => (
                    <s-table-row key={entry.id}>
                      <s-table-cell>
                        <s-stack direction="block" gap="small-500">
                          <s-text>{formatBdPhone(entry.phone)}</s-text>
                          <s-text color="subdued">{entry.name ?? "Unknown"}</s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="block" gap="small-500">
                          <s-badge tone={SOURCE_TONE[entry.source]}>
                            {SOURCE_LABEL[entry.source]}
                          </s-badge>
                          {entry.note ? (
                            <s-text color="subdued">{entry.note}</s-text>
                          ) : null}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>{entry.addedAt}</s-table-cell>
                      <s-table-cell>
                        <s-button
                          onClick={() => removeEntry(entry.id)}
                          {...(entry.source === "STOP" ? { tone: "critical" } : {})}
                          {...(removeFetcher.state !== "idle" ? { loading: true } : {})}
                        >
                          Unblock
                        </s-button>
                      </s-table-cell>
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
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      next.set("page", String(data.page - 1));
                      setParams(next);
                    }}
                  >
                    Previous
                  </s-button>
                  <s-text color="subdued">
                    Page {data.page} of {data.pages}
                  </s-text>
                  <s-button
                    {...(data.page >= data.pages ? { disabled: true } : {})}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      next.set("page", String(data.page + 1));
                      setParams(next);
                    }}
                  >
                    Next
                  </s-button>
                </s-stack>
              ) : null}

              <s-text color="subdued">
                Showing {data.rows.length} of {data.total.toLocaleString()}
                {hasFilters ? " matching" : ""} · {PAGE_SIZE} per page
              </s-text>
            </s-stack>
          )}

          <s-text color="subdued">
            Unblocking a customer who replied STOP does not restore their consent
            — you need their permission again before sending marketing.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
