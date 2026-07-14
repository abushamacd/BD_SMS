// The automation registry. Isomorphic on purpose: the Settings UI reads the
// labels and variable chips from here, and the server validates templates
// against the same list, so the chips a merchant can click and the variables the
// server accepts cannot drift apart.

export const AUTOMATIONS = [
  {
    key: "NEW_ORDER",
    name: "New Order SMS",
    description: "Sent as soon as a customer places an order.",
    variables: ["customer_name", "order_number", "order_total", "shop_name"],
  },
  {
    key: "FULFILLMENT",
    name: "Order Fulfillment SMS",
    description: "Sent when the order is marked as fulfilled.",
    variables: ["customer_name", "order_number", "shop_name"],
  },
  {
    key: "SHIPMENT",
    name: "Order Shipment SMS",
    description:
      "Sent when a shipment is created. Only sent if the fulfillment has tracking — a tracking message with no link is just the fulfillment message again.",
    variables: [
      "customer_name",
      "order_number",
      "tracking_url",
      "tracking_number",
      "shop_name",
    ],
  },
  {
    key: "DELIVERY",
    name: "Order Delivery SMS",
    description: "Sent when the courier reports the parcel as delivered.",
    variables: ["customer_name", "order_number", "shop_name"],
  },
  {
    key: "CANCELLED",
    name: "Order Cancelled SMS",
    description: "Sent when an order is cancelled.",
    variables: ["customer_name", "order_number", "shop_name"],
  },
  {
    key: "COD_OTP",
    name: "COD OTP Verification SMS",
    description:
      "Sent after a cash-on-delivery order is placed. The order is tagged cod-unconfirmed until the customer confirms with the code, so you can hold it before shipping.",
    variables: [
      "customer_name",
      "order_number",
      "order_total",
      "otp_code",
      "confirm_url",
      "shop_name",
    ],
  },
];

export const ABANDONED_CART_KEYS = [
  "ABANDONED_CART_1",
  "ABANDONED_CART_2",
  "ABANDONED_CART_3",
];

const ABANDONED_VARIABLES = [
  "customer_name",
  "cart_total",
  "recovery_url",
  "discount_code",
  "shop_name",
];

/** key → allowed variables. The server validates against this. */
export const TEMPLATE_VARIABLES = {
  ...Object.fromEntries(
    AUTOMATIONS.map((automation) => [automation.key, automation.variables]),
  ),
  ABANDONED_CART_1: ABANDONED_VARIABLES.filter((v) => v !== "discount_code"),
  ABANDONED_CART_2: ABANDONED_VARIABLES,
  ABANDONED_CART_3: ABANDONED_VARIABLES,
  CAMPAIGN: ["customer_name", "shop_name"],
};

/** Sample values for the live preview and test sends. */
export const SAMPLE_VALUES = {
  customer_name: "Rakib Hasan",
  order_number: "1042",
  order_total: "1,250 BDT",
  cart_total: "2,450 BDT",
  tracking_url: "https://bdsms.link/t/ab12cd",
  tracking_number: "TRK123456",
  recovery_url: "https://bdsms.link/r/xy98zw",
  confirm_url: "https://bdsms.link/c/ab12cd",
  discount_code: "COMEBACK10",
  otp_code: "482913",
  shop_name: "Your Shop",
};
