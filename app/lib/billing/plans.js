// Credit packages and subscription plans.
//
// Isomorphic on purpose: the Billing page renders these and the SERVER PRICES
// FROM THEM. The price charged is never taken from the form — a browser can post
// any number it likes, and "5,000 credits for $0.01" is exactly the request a
// merchant would send if the price came from the client.
//
// CURRENCY: USD, not BDT. Shopify bills merchants in a short list of local
// currencies (AUD, CAD, EUR, INR, JPY, GBP, CZK, DKK, CHF, NOK, PLN, RON, SGD,
// SEK) and bills everyone else — Bangladesh included — in USD. A Dhaka merchant
// sells in Taka but pays us in dollars. Quoting BDT here would be a lie the
// Shopify confirmation screen would immediately contradict.
// https://help.shopify.com/manual/your-account/manage-billing/your-invoice/local-currency

export const CURRENCY = "USD";

export const CREDIT_PACKAGES = [
  { id: "pkg_1k", credits: 1000, price: 8, popular: false, save: null },
  { id: "pkg_5k", credits: 5000, price: 35, popular: true, save: "12%" },
  { id: "pkg_10k", credits: 10000, price: 65, popular: false, save: "19%" },
  { id: "pkg_25k", credits: 25000, price: 150, popular: false, save: "25%" },
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

export function getPackage(id) {
  return CREDIT_PACKAGES.find((entry) => entry.id === id) ?? null;
}

export function getPlan(id) {
  return PLANS.find((entry) => entry.id === id) ?? null;
}

/** Per-credit price, for the "save 19%" copy. Derived, never stored — they cannot disagree. */
export function perCredit(pkg) {
  return pkg.price / pkg.credits;
}

/**
 * The name shown on the merchant's Shopify invoice. It must say what they bought
 * — "BD SMS" on a bank statement, with no indication of what it was for, is what
 * generates chargebacks.
 */
export function chargeName(pkg) {
  return `${pkg.credits.toLocaleString()} SMS credits`;
}

export function planChargeName(plan) {
  return `BD SMS ${plan.name}`;
}
