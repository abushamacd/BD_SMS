// The provider registry that drives the gateway form. Isomorphic — the page
// renders it and the server validates against it, so the fields a merchant can
// fill in and the fields we require cannot drift apart.
//
// `value` is the GatewayProvider enum in the Prisma schema. The request shape
// each provider actually expects lives in its adapter.

export const GATEWAY_MODES = [
  {
    value: "DEFAULT",
    label: "Use our gateway",
    details:
      "We deliver your messages and you buy credits from us. No monthly fee — you only pay for what you send.",
  },
  {
    value: "PERSONAL",
    label: "Use my own gateway",
    details:
      "Bring your own SMS provider and buy credits from them. Requires an app subscription.",
  },
];

export const PROVIDERS = [
  {
    value: "BULKSMSBD",
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
    value: "MIMSMS",
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
    value: "SSLWIRELESS",
    label: "SSL Wireless",
    url: "https://smsplus.sslwireless.com/api/v3/send-sms",
    urlEditable: false,
    fields: [
      { key: "apiKey", label: "API token", secret: true },
      { key: "senderId", label: "SID", details: "Your approved SSL Wireless SID." },
    ],
  },
  {
    value: "GENERIC",
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

export const DEFAULT_URL_TEMPLATE =
  "https://provider.example/send?api_key={{api_key}}&to={{phone}}&from={{sender_id}}&text={{message}}";

/** The variables a generic URL template must carry, or nothing can be sent. */
export const REQUIRED_TEMPLATE_VARIABLES = ["phone", "message"];

export function getProvider(value) {
  return PROVIDERS.find((provider) => provider.value === value) ?? PROVIDERS[0];
}

/** Which of this provider's fields are secret — those are never sent to the browser. */
export function secretKeys(provider) {
  return getProvider(provider)
    .fields.filter((field) => field.secret)
    .map((field) => field.key);
}
