// Mock abandoned checkouts for the Phase 1 UI. Phase 4 replaces this with real
// AbandonedCheckout records fed by the checkouts/create + checkouts/update
// webhooks.
//
// Note this is abandoned *checkout*, not abandoned *cart*: Shopify only gives
// us a phone number once the customer reaches checkout and enters their contact
// details. A customer who added to cart and left has no phone number attached,
// so there is nobody to text.

export const DELAY_OPTIONS = [
  { value: "1", label: "1 hour after abandoning" },
  { value: "3", label: "3 hours after abandoning" },
  { value: "6", label: "6 hours after abandoning" },
  { value: "12", label: "12 hours after abandoning" },
  { value: "24", label: "24 hours after abandoning" },
  { value: "48", label: "48 hours after abandoning" },
  { value: "72", label: "72 hours after abandoning" },
];

export const VARIABLES = [
  "customer_name",
  "cart_total",
  "recovery_url",
  "discount_code",
  "shop_name",
];

export const SAMPLE_VALUES = {
  customer_name: "Rakib Hasan",
  cart_total: "2,450 BDT",
  recovery_url: "https://bdsms.link/r/xy98zw",
  discount_code: "COMEBACK10",
  shop_name: "Dhaka Fashion",
};

export const settings = {
  enabled: true,

  discountEnabled: true,
  discountCode: "COMEBACK10",

  // A sequence, not a single message. The first nudge is a reminder; only the
  // later ones spend margin on a discount.
  followUps: [
    {
      id: 1,
      enabled: true,
      delay: "1",
      includeDiscount: false,
      template:
        "Dear {{customer_name}}, you left {{cart_total}} in your cart at {{shop_name}}. Complete your order: {{recovery_url}}",
    },
    {
      id: 2,
      enabled: true,
      delay: "24",
      includeDiscount: true,
      template:
        "Still thinking it over, {{customer_name}}? Use code {{discount_code}} for a discount. Complete your order: {{recovery_url}}",
    },
    {
      id: 3,
      enabled: false,
      delay: "72",
      includeDiscount: true,
      template:
        "Last chance, {{customer_name}} — your cart expires soon. Use {{discount_code}} to save. {{recovery_url}}",
    },
  ],
};

export const stats = {
  sent: 214,
  clicked: 63,
  recovered: 31,
  revenue: 87450,
};

export const STATUS_TONE = {
  waiting: "neutral",
  sent: "info",
  recovered: "success",
  expired: "neutral",
  skipped: "warning",
};

export const checkouts = [
  {
    id: "ac_9001",
    customer: "Sabbir Rahman",
    phone: "8801712345685",
    cartValue: 2450,
    abandonedAt: "12 Jul, 3:12 PM",
    abandonedAgo: "22 minutes ago",
    followUpsSent: 0,
    status: "waiting",
    recovered: false,
    smsConsent: true,
    nextSendIn: "38 minutes",
  },
  {
    id: "ac_9002",
    customer: "Nusrat Jahan",
    phone: "8801812345679",
    cartValue: 5900,
    abandonedAt: "12 Jul, 11:40 AM",
    abandonedAgo: "4 hours ago",
    followUpsSent: 1,
    status: "sent",
    recovered: false,
    smsConsent: true,
    nextSendIn: "20 hours",
  },
  {
    id: "ac_9003",
    customer: "Tanvir Ahmed",
    phone: "8801912345680",
    cartValue: 1250,
    abandonedAt: "12 Jul, 9:05 AM",
    abandonedAgo: "6 hours ago",
    followUpsSent: 0,
    status: "skipped",
    recovered: false,
    smsConsent: false,
    nextSendIn: null,
  },
  {
    id: "ac_9004",
    customer: "Farhana Akter",
    phone: "8801312345683",
    cartValue: 12400,
    abandonedAt: "11 Jul, 6:22 PM",
    abandonedAgo: "yesterday",
    followUpsSent: 2,
    status: "recovered",
    recovered: true,
    smsConsent: true,
    nextSendIn: null,
  },
  {
    id: "ac_9005",
    customer: "Arif Chowdhury",
    phone: "8801912345687",
    cartValue: 3800,
    abandonedAt: "10 Jul, 2:15 PM",
    abandonedAgo: "2 days ago",
    followUpsSent: 2,
    status: "expired",
    recovered: false,
    smsConsent: true,
    nextSendIn: null,
  },
];
