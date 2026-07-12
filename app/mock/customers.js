// Mock customer list for the Phase 1 UI. Phase 3 replaces this with a real
// Shopify customer query (which requires protected customer data approval to
// return phone numbers in production).

export const CREDIT_BALANCE = 342;

export const TAGS = ["vip", "wholesale", "dhaka", "chittagong", "repeat"];

// smsConsent mirrors Shopify's smsMarketingConsent. Marketing messages may only
// go to customers who opted in; transactional ones (order status, OTP) may not.
export const customers = [
  { id: 1, name: "Rakib Hasan", phone: "8801712345678", orders: 12, totalSpent: 48200, tags: ["vip", "repeat", "dhaka"], smsConsent: true },
  { id: 2, name: "Nusrat Jahan", phone: "8801812345679", orders: 5, totalSpent: 15400, tags: ["repeat", "dhaka"], smsConsent: true },
  { id: 3, name: "Tanvir Ahmed", phone: "8801912345680", orders: 1, totalSpent: 1250, tags: ["chittagong"], smsConsent: false },
  { id: 4, name: "Sadia Islam", phone: "8801612345681", orders: 8, totalSpent: 27300, tags: ["vip", "repeat"], smsConsent: true },
  { id: 5, name: "Imran Kabir", phone: "8801512345682", orders: 2, totalSpent: 3800, tags: ["dhaka"], smsConsent: true },
  { id: 6, name: "Farhana Akter", phone: "8801312345683", orders: 21, totalSpent: 96500, tags: ["vip", "wholesale", "repeat"], smsConsent: true },
  { id: 7, name: "Mehedi Hasan", phone: "8801412345684", orders: 3, totalSpent: 7200, tags: ["chittagong", "repeat"], smsConsent: false },
  { id: 8, name: "Sabbir Rahman", phone: "8801712345685", orders: 1, totalSpent: 990, tags: [], smsConsent: true },
  { id: 9, name: "Jannatul Ferdous", phone: "8801812345686", orders: 15, totalSpent: 61000, tags: ["vip", "wholesale"], smsConsent: true },
  { id: 10, name: "Arif Chowdhury", phone: "8801912345687", orders: 4, totalSpent: 11800, tags: ["dhaka", "repeat"], smsConsent: true },
  { id: 11, name: "Sumaiya Khatun", phone: "8801612345688", orders: 6, totalSpent: 19400, tags: ["repeat"], smsConsent: false },
  { id: 12, name: "Nayeem Uddin", phone: "8801512345689", orders: 2, totalSpent: 4500, tags: ["chittagong"], smsConsent: true },
];
