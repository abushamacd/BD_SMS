import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { SettingsNav } from "../components/SettingsNav";
import { parsePhoneList } from "../lib/phone";
import {
  SOURCES,
  SOURCE_LABEL,
  SOURCE_TONE,
  entries,
  settings,
} from "../mock/blacklist";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Phase 1: mock data. Phase 6 loads real Blacklist records.
  return { entries, settings, sources: SOURCES };
};

export default function Blacklist() {
  const data = useLoaderData();

  const [list, setList] = useState(data.entries);
  const [blockTransactional, setBlockTransactional] = useState(
    data.settings.blockTransactional,
  );
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");

  const parsed = useMemo(() => parsePhoneList(input), [input]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return list.filter((entry) => {
      if (source !== "all" && entry.source !== source) return false;
      if (
        term &&
        !entry.phone.includes(term) &&
        !entry.name.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [list, search, source]);

  const alreadyBlocked = useMemo(
    () => new Set(list.map((entry) => entry.phone)),
    [list],
  );

  const toAdd = parsed.valid.filter((entry) => !alreadyBlocked.has(entry.e164));
  const duplicates = parsed.valid.length - toAdd.length;

  // Local-only until Phase 6 — this edits the list in the browser so the screen
  // can be reviewed, but nothing is persisted.
  const addNumbers = () => {
    setList((prev) => [
      ...toAdd.map((entry, index) => ({
        id: `bl_new_${Date.now()}_${index}`,
        phone: entry.e164,
        name: "Unknown",
        source: "manual",
        addedAt: "Just now",
        note: note.trim() || "Added manually",
      })),
      ...prev,
    ]);
    setInput("");
    setNote("");
  };

  const removeEntry = (id) => {
    setList((prev) => prev.filter((entry) => entry.id !== id));
  };

  const stopCount = list.filter((entry) => entry.source === "stop").length;

  return (
    <s-page heading="Blacklist">
      <s-section>
        <SettingsNav current="/app/settings/blacklist" />
      </s-section>

      <s-banner tone="info" heading="Preview mode">
        <s-paragraph>
          Changes here are not saved yet — STOP handling and the real blacklist
          arrive in Phase 6. Adding and removing works in the browser so you can
          review the screen.
        </s-paragraph>
      </s-banner>

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
            <s-badge tone="critical">{stopCount} opted out</s-badge>
            <s-badge tone="neutral">{list.length} blocked in total</s-badge>
          </s-stack>

          <s-divider />

          <s-switch
            label="Also block order updates and OTP codes"
            details="Off by default. Opting out of marketing does not usually mean a customer wants to stop receiving the OTP that confirms their own order, or the SMS telling them it has shipped. Turn this on only if you want a blocked number to receive nothing at all."
            checked={blockTransactional}
            onChange={() => setBlockTransactional((value) => !value)}
          />

          {blockTransactional ? (
            <s-banner tone="warning" heading="COD verification will fail for these numbers">
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
              <s-badge tone="success">{toAdd.length} to block</s-badge>
              {duplicates > 0 ? (
                <s-badge tone="neutral">{duplicates} already blocked</s-badge>
              ) : null}
              {parsed.invalid.length > 0 ? (
                <s-badge tone="critical">
                  {parsed.invalid.length} invalid
                </s-badge>
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

          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              onClick={addNumbers}
              {...(toAdd.length === 0 ? { disabled: true } : {})}
            >
              {toAdd.length > 1
                ? `Block ${toAdd.length} numbers`
                : "Block number"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Blocked numbers">
        <s-stack direction="block" gap="base">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
            gap="base"
          >
            <s-search-field
              label="Search"
              placeholder="Name or phone number"
              value={search}
              onInput={(event) => setSearch(event.target.value)}
            />

            <s-select
              label="Reason"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <s-option value="all">All reasons</s-option>
              {data.sources.map((option) => (
                <s-option key={option.value} value={option.value}>
                  {option.label}
                </s-option>
              ))}
            </s-select>
          </s-grid>

          {filtered.length === 0 ? (
            <s-paragraph>
              {list.length === 0
                ? "No numbers are blocked. Customers who reply STOP will appear here automatically."
                : "No blocked numbers match these filters."}
            </s-paragraph>
          ) : (
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header>Number</s-table-header>
                <s-table-header>Reason</s-table-header>
                <s-table-header>Blocked</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {filtered.map((entry) => (
                  <s-table-row key={entry.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-500">
                        <s-text>{entry.phone}</s-text>
                        <s-text color="subdued">{entry.name}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-500">
                        <s-badge tone={SOURCE_TONE[entry.source]}>
                          {SOURCE_LABEL[entry.source]}
                        </s-badge>
                        <s-text color="subdued">{entry.note}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{entry.addedAt}</s-table-cell>
                    <s-table-cell>
                      <s-button
                        onClick={() => removeEntry(entry.id)}
                        {...(entry.source === "stop" ? { tone: "critical" } : {})}
                      >
                        Unblock
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
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
