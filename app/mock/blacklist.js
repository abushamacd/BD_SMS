// Mock blacklist for the Phase 1 UI. Phase 6 replaces this with real Blacklist
// records, populated by STOP replies arriving on the gateway's inbound webhook.

export const SOURCES = [
  { value: "stop", label: "Replied STOP" },
  { value: "manual", label: "Added manually" },
  { value: "dnd", label: "Operator DND list" },
  { value: "bounced", label: "Repeatedly undeliverable" },
];

export const SOURCE_LABEL = Object.fromEntries(
  SOURCES.map((source) => [source.value, source.label]),
);

export const SOURCE_TONE = {
  stop: "critical",
  manual: "neutral",
  dnd: "warning",
  bounced: "warning",
};

// When someone opts out, marketing must stop. Whether *transactional* messages
// (order updates, COD OTP) should also stop is a real choice: a customer who
// opted out of marketing still needs the OTP that confirms their own order.
// Defaults to off for that reason.
export const settings = {
  blockTransactional: false,
};

export const entries = [
  {
    id: "bl_1",
    phone: "8801712345691",
    name: "Kamrul Islam",
    source: "stop",
    addedAt: "12 Jul 2026, 9:14 AM",
    note: 'Replied "STOP" to a campaign message',
  },
  {
    id: "bl_2",
    phone: "8801412345684",
    name: "Mehedi Hasan",
    source: "dnd",
    addedAt: "11 Jul 2026, 4:02 PM",
    note: "Gateway rejected: number is on the operator DND list",
  },
  {
    id: "bl_3",
    phone: "8801912345692",
    name: "Unknown",
    source: "manual",
    addedAt: "09 Jul 2026, 11:30 AM",
    note: "Customer asked to be removed by phone",
  },
  {
    id: "bl_4",
    phone: "8801112345690",
    name: "Unknown",
    source: "bounced",
    addedAt: "08 Jul 2026, 2:45 PM",
    note: "Failed 5 times — invalid number format",
  },
  {
    id: "bl_5",
    phone: "8801812345693",
    name: "Rumana Begum",
    source: "stop",
    addedAt: "05 Jul 2026, 6:20 PM",
    note: 'Replied "STOP" to an abandoned cart reminder',
  },
];
