// Gateway presets for the Phase 1 UI.
//
// Each preset declares the credentials a merchant must supply. The exact
// request shape each provider expects (parameter names, GET vs POST, response
// codes) lives in the adapter, which is built in Phase 2 — that is where each
// provider's live API is verified. This file only drives the form.

export const GATEWAY_MODES = [
  {
    value: "default",
    label: "Use our gateway",
    details:
      "We deliver your messages and you buy credits from us. No monthly fee — you only pay for what you send.",
  },
  {
    value: "personal",
    label: "Use my own gateway",
    details:
      "Bring your own SMS provider and buy credits from them. Requires an app subscription.",
  },
];

export const PROVIDERS = [
  {
    value: "bulksmsbd",
    label: "BulkSMSBD",
    url: "https://bulksmsbd.net/api/smsapi",
    urlEditable: false,
    fields: [
      { key: "apiKey", label: "API key", secret: true },
      {
        key: "senderId",
        label: "Sender ID",
        details: "The masking or number approved on your BulkSMSBD account.",
      },
    ],
  },
  {
    value: "mimsms",
    label: "MiMSMS",
    url: "https://api.mimsms.com/api/SmsSending/SMS",
    urlEditable: false,
    fields: [
      { key: "username", label: "Username" },
      { key: "apiKey", label: "API key", secret: true },
      { key: "senderId", label: "Sender name" },
    ],
  },
  {
    value: "sslwireless",
    label: "SSL Wireless",
    url: "https://smsplus.sslwireless.com/api/v3/send-sms",
    urlEditable: false,
    fields: [
      { key: "apiKey", label: "API token", secret: true },
      { key: "senderId", label: "SID", details: "Your approved SSL Wireless SID." },
    ],
  },
  {
    value: "generic",
    label: "Other provider (generic HTTP)",
    url: "",
    urlEditable: true,
    fields: [
      { key: "apiKey", label: "API key", secret: true },
      { key: "senderId", label: "Sender ID" },
    ],
  },
];

export const HTTP_METHODS = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
];

export const gateway = {
  mode: "default",
  provider: "bulksmsbd",
  apiKey: "",
  username: "",
  senderId: "",
  url: "",
  method: "GET",
  // Generic providers get a URL template. The adapter substitutes these before
  // calling the provider.
  urlTemplate:
    "https://provider.example/send?api_key={{api_key}}&to={{phone}}&from={{sender_id}}&text={{message}}",
};

// Shown after a "Test connection" so the merchant sees a result rather than a
// spinner that resolves into nothing. Phase 2 replaces this with a real call.
export const SAMPLE_TEST_RESULT = {
  ok: true,
  message: "Connected. Test SMS accepted by the gateway.",
  balance: "12,480 credits at BulkSMSBD",
};
