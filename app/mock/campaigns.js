// Mock campaigns for the Phase 1 UI. Phase 4 replaces this with real Campaign /
// CampaignRecipient records driven by the job queue.

export const SEGMENTS = [
  {
    value: "consented",
    label: "All customers who accepted SMS marketing",
    details: "The safe default. Everyone who opted in.",
  },
  {
    value: "tag",
    label: "By customer tag",
    details: "Target a segment you already maintain in Shopify.",
  },
  {
    value: "orders",
    label: "By number of orders",
    details: "Reward repeat buyers, or win back one-time customers.",
  },
  {
    value: "recency",
    label: "By last order date",
    details: "Reach customers who have not bought in a while.",
  },
];

export const RECENCY_OPTIONS = [
  { value: "30", label: "No order in the last 30 days" },
  { value: "60", label: "No order in the last 60 days" },
  { value: "90", label: "No order in the last 90 days" },
  { value: "180", label: "No order in the last 180 days" },
];

export const campaigns = [
  {
    id: "cmp_1041",
    name: "Eid Sale — 25% off",
    status: "completed",
    segment: "All SMS-consented customers",
    recipients: 1840,
    sent: 1840,
    delivered: 1772,
    failed: 68,
    credits: 3680,
    createdAt: "28 Jun, 10:12 AM",
    scheduledFor: null,
  },
  {
    id: "cmp_1042",
    name: "New arrivals — Summer collection",
    status: "sending",
    segment: "Tag: repeat",
    recipients: 620,
    sent: 388,
    delivered: 351,
    failed: 12,
    credits: 776,
    createdAt: "12 Jul, 11:03 AM",
    scheduledFor: null,
  },
  {
    id: "cmp_1043",
    name: "VIP early access",
    status: "paused",
    segment: "Tag: vip",
    recipients: 214,
    sent: 96,
    delivered: 92,
    failed: 2,
    credits: 192,
    createdAt: "11 Jul, 4:40 PM",
    scheduledFor: null,
  },
  {
    id: "cmp_1044",
    name: "Win back — no order in 90 days",
    status: "scheduled",
    segment: "No order in the last 90 days",
    recipients: 430,
    sent: 0,
    delivered: 0,
    failed: 0,
    credits: 0,
    createdAt: "12 Jul, 9:15 AM",
    scheduledFor: "15 Jul, 11:00 AM",
  },
  {
    id: "cmp_1045",
    name: "Friday flash sale",
    status: "draft",
    segment: "All SMS-consented customers",
    recipients: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    credits: 0,
    createdAt: "12 Jul, 1:22 PM",
    scheduledFor: null,
  },
];

export const STATUS_TONE = {
  draft: "neutral",
  scheduled: "info",
  sending: "accent",
  paused: "warning",
  completed: "success",
};

// Per-recipient detail for the campaign detail page.
export const campaignRecipients = [
  { id: 1, name: "Rakib Hasan", phone: "8801712345678", status: "delivered", credits: 2, sentAt: "12 Jul, 11:04 AM", error: null },
  { id: 2, name: "Nusrat Jahan", phone: "8801812345679", status: "delivered", credits: 2, sentAt: "12 Jul, 11:04 AM", error: null },
  { id: 3, name: "Sadia Islam", phone: "8801612345681", status: "sent", credits: 2, sentAt: "12 Jul, 11:05 AM", error: null },
  { id: 4, name: "Imran Kabir", phone: "8801512345682", status: "failed", credits: 2, sentAt: "12 Jul, 11:05 AM", error: "Number unreachable" },
  { id: 5, name: "Farhana Akter", phone: "8801312345683", status: "delivered", credits: 2, sentAt: "12 Jul, 11:05 AM", error: null },
  { id: 6, name: "Arif Chowdhury", phone: "8801912345687", status: "queued", credits: 2, sentAt: null, error: null },
  { id: 7, name: "Nayeem Uddin", phone: "8801512345689", status: "queued", credits: 2, sentAt: null, error: null },
];

export const RECIPIENT_TONE = {
  queued: "neutral",
  sent: "info",
  delivered: "success",
  failed: "critical",
};
