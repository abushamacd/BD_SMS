// Mock settings for the Phase 1 UI. Replaced by real ShopSettings /
// MessageTemplate records in Phase 3.

// Sample values used to render the live preview. The credit counter runs on the
// *rendered* message, not the raw template — {{customer_name}} is 17 characters
// but "Rakib Hasan" is 11, so counting the template would misprice every send.
export const SAMPLE_VALUES = {
  customer_name: "Rakib Hasan",
  order_number: "1042",
  order_total: "1,250 BDT",
  tracking_url: "https://bdsms.link/t/ab12cd",
  shop_name: "Dhaka Fashion",
  otp_code: "482913",
  recovery_url: "https://bdsms.link/r/xy98zw",
};

export const AUTOMATIONS = [
  {
    key: "new_order",
    name: "New Order SMS",
    description: "Sent as soon as a customer places an order.",
    variables: ["customer_name", "order_number", "order_total", "shop_name"],
  },
  {
    key: "fulfillment",
    name: "Order Fulfillment SMS",
    description: "Sent when the order is marked as fulfilled.",
    variables: ["customer_name", "order_number", "shop_name"],
  },
  {
    key: "shipment",
    name: "Order Shipment SMS",
    description: "Sent when the order ships, with a tracking link.",
    variables: ["customer_name", "order_number", "tracking_url", "shop_name"],
  },
  {
    key: "delivery",
    name: "Order Delivery SMS",
    description: "Sent when the courier confirms delivery.",
    variables: ["customer_name", "order_number", "shop_name"],
  },
  {
    key: "cancelled",
    name: "Order Cancelled SMS",
    description: "Sent when an order is cancelled.",
    variables: ["customer_name", "order_number", "shop_name"],
  },
  {
    key: "cod_otp",
    name: "COD OTP Verification SMS",
    description:
      "Sent after a cash-on-delivery order is placed. The customer confirms with the code, and unconfirmed orders are tagged so you can hold them.",
    variables: ["customer_name", "order_number", "otp_code", "shop_name"],
  },
  {
    key: "abandoned_cart",
    name: "Abandoned Cart SMS",
    description:
      "Sent to customers who reached checkout but did not complete the order.",
    variables: ["customer_name", "recovery_url", "shop_name"],
  },
];

export const settings = {
  senderId: "8809648909584",
  countryCode: "+880",
  quietHoursEnabled: true,
  quietHoursStart: "22",
  quietHoursEnd: "8",

  automations: {
    new_order: {
      enabled: true,
      template:
        "Dear {{customer_name}}, your order #{{order_number}} of {{order_total}} has been received. Thank you for shopping with {{shop_name}}.",
    },
    fulfillment: {
      enabled: true,
      template:
        "Dear {{customer_name}}, your order #{{order_number}} is packed and ready to ship. - {{shop_name}}",
    },
    shipment: {
      enabled: true,
      template:
        "Dear {{customer_name}}, order #{{order_number}} has been shipped. Track it here: {{tracking_url}} - {{shop_name}}",
    },
    delivery: {
      enabled: false,
      template:
        "Dear {{customer_name}}, order #{{order_number}} has been delivered. Thank you for shopping with {{shop_name}}.",
    },
    cancelled: {
      enabled: false,
      template:
        "Dear {{customer_name}}, your order #{{order_number}} has been cancelled. Contact us if this was a mistake. - {{shop_name}}",
    },
    cod_otp: {
      enabled: true,
      template:
        "Your {{shop_name}} verification code is {{otp_code}}. Reply with this code to confirm order #{{order_number}}.",
    },
    abandoned_cart: {
      enabled: true,
      template:
        "Dear {{customer_name}}, you left items in your cart. Complete your order here: {{recovery_url}} - {{shop_name}}",
    },
  },
};
