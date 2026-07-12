// Mock billing data for the Phase 1 UI. Phase 5 replaces this with the Shopify
// Billing API (appSubscriptionCreate + appPurchaseOneTime).
//
// CURRENCY: prices are in USD, not BDT. Shopify only bills merchants in a short
// list of local currencies (AUD, CAD, EUR, INR, JPY, GBP, CZK, DKK, CHF, NOK,
// PLN, RON, SGD, SEK) and bills everyone else — Bangladesh included — in USD.
// So a Dhaka merchant sells in Taka but pays us in dollars. Showing BDT prices
// here would be a lie the checkout would immediately contradict.
// https://help.shopify.com/manual/your-account/manage-billing/your-invoice/local-currency

// "default" = merchant sends through our gateway and buys credits from us.
// "personal" = merchant brought their own gateway; they pay a subscription and
// their credits live at their own provider, not with us.
export const gatewayMode = "default";

export const balance = 342;

export const CREDIT_PACKAGES = [
  { id: "pkg_1k", credits: 1000, price: 8, perCredit: 0.008, popular: false, save: null },
  { id: "pkg_5k", credits: 5000, price: 35, perCredit: 0.007, popular: true, save: "12%" },
  { id: "pkg_10k", credits: 10000, price: 65, perCredit: 0.0065, popular: false, save: "19%" },
  { id: "pkg_25k", credits: 25000, price: 150, perCredit: 0.006, popular: false, save: "25%" },
];

export const PLANS = [
  {
    id: "starter",
    name: "Starter",
    price: 9.99,
    limit: "Up to 5,000 SMS per month",
    features: [
      "All order automations",
      "COD OTP verification",
      "SMS log and delivery reports",
      "Send SMS to selected customers",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: 19.99,
    limit: "Up to 25,000 SMS per month",
    popular: true,
    features: [
      "Everything in Starter",
      "Campaigns with audience segments",
      "Abandoned checkout recovery",
      "Scheduled sending",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 39.99,
    limit: "Unlimited SMS",
    features: [
      "Everything in Growth",
      "Priority delivery queue",
      "Multiple sender IDs",
      "Priority support",
    ],
  },
];

export const currentPlan = "growth";

export const autoRecharge = {
  enabled: false,
  threshold: 500,
  packageId: "pkg_5k",
};

export const purchases = [
  { id: "p_301", date: "28 Jun 2026", description: "5,000 credits", amount: 35, credits: 5000, status: "paid" },
  { id: "p_302", date: "02 Jun 2026", description: "5,000 credits", amount: 35, credits: 5000, status: "paid" },
  { id: "p_303", date: "11 May 2026", description: "1,000 credits", amount: 8, credits: 1000, status: "paid" },
  { id: "p_304", date: "03 May 2026", description: "1,000 credits", amount: 8, credits: 1000, status: "refunded" },
];

export const PURCHASE_TONE = {
  paid: "success",
  pending: "info",
  refunded: "neutral",
  failed: "critical",
};
