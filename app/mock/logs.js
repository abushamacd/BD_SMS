// Mock SMS log for the Phase 1 UI. Phase 2 replaces this with real SmsLog rows
// written by the send pipeline.

export const TYPES = [
  { value: "order", label: "Order" },
  { value: "campaign", label: "Campaign" },
  { value: "otp", label: "COD OTP" },
  { value: "abandoned", label: "Abandoned cart" },
  { value: "manual", label: "Manual" },
];

export const STATUSES = [
  { value: "queued", label: "Queued" },
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Failed" },
];

export const STATUS_TONE = {
  queued: "neutral",
  sent: "info",
  delivered: "success",
  failed: "critical",
};

export const TYPE_LABEL = Object.fromEntries(
  TYPES.map((type) => [type.value, type.label]),
);

export const logs = [
  { id: "sms_5001", date: "2026-07-12", time: "2:41 PM", name: "Rakib Hasan", phone: "8801712345678", type: "order", message: "Dear Rakib Hasan, your order #1042 of 1,250 BDT has been received. Thank you for shopping with Dhaka Fashion.", credits: 1, status: "delivered", gateway: "BulkSMSBD", error: null },
  { id: "sms_5002", date: "2026-07-12", time: "2:38 PM", name: "Nusrat Jahan", phone: "8801812345679", type: "otp", message: "Your Dhaka Fashion verification code is 482913. Reply with this code to confirm order #1041.", credits: 1, status: "delivered", gateway: "BulkSMSBD", error: null },
  { id: "sms_5003", date: "2026-07-12", time: "2:15 PM", name: "Tanvir Ahmed", phone: "8801912345680", type: "abandoned", message: "Dear Tanvir Ahmed, you left 2,450 BDT in your cart at Dhaka Fashion. Complete your order: https://bdsms.link/r/xy98zw", credits: 2, status: "sent", gateway: "BulkSMSBD", error: null },
  { id: "sms_5004", date: "2026-07-12", time: "1:52 PM", name: "Sadia Islam", phone: "8801612345681", type: "order", message: "Dear Sadia Islam, order #1039 has been shipped. Track it here: https://bdsms.link/t/ab12cd - Dhaka Fashion", credits: 1, status: "delivered", gateway: "BulkSMSBD", error: null },
  { id: "sms_5005", date: "2026-07-12", time: "1:30 PM", name: "Imran Kabir", phone: "8801512345682", type: "campaign", message: "আপনার প্রিয় পণ্যে ২৫% ছাড়! আজই কিনুন। - Dhaka Fashion", credits: 1, status: "failed", gateway: "BulkSMSBD", error: "1007 — Balance insufficient at gateway" },
  { id: "sms_5006", date: "2026-07-12", time: "11:05 AM", name: "Farhana Akter", phone: "8801312345683", type: "campaign", message: "New arrivals just landed. Shop the summer collection now: https://bdsms.link/c/s24 - Dhaka Fashion", credits: 2, status: "delivered", gateway: "BulkSMSBD", error: null },
  { id: "sms_5007", date: "2026-07-12", time: "11:05 AM", name: "Mehedi Hasan", phone: "8801412345684", type: "campaign", message: "New arrivals just landed. Shop the summer collection now: https://bdsms.link/c/s24 - Dhaka Fashion", credits: 2, status: "failed", gateway: "BulkSMSBD", error: "1032 — Number is on the operator DND list" },
  { id: "sms_5008", date: "2026-07-12", time: "11:04 AM", name: "Sabbir Rahman", phone: "8801712345685", type: "campaign", message: "New arrivals just landed. Shop the summer collection now: https://bdsms.link/c/s24 - Dhaka Fashion", credits: 2, status: "queued", gateway: "BulkSMSBD", error: null },
  { id: "sms_5009", date: "2026-07-11", time: "6:22 PM", name: "Jannatul Ferdous", phone: "8801812345686", type: "manual", message: "Your custom order is ready for pickup. Please visit our Dhanmondi outlet before 8 PM.", credits: 1, status: "delivered", gateway: "BulkSMSBD", error: null },
  { id: "sms_5010", date: "2026-07-11", time: "4:40 PM", name: "Arif Chowdhury", phone: "8801912345687", type: "order", message: "Dear Arif Chowdhury, your order #1038 has been cancelled. Contact us if this was a mistake. - Dhaka Fashion", credits: 1, status: "delivered", gateway: "BulkSMSBD", error: null },
  { id: "sms_5011", date: "2026-07-11", time: "3:18 PM", name: "Sumaiya Khatun", phone: "8801612345688", type: "otp", message: "Your Dhaka Fashion verification code is 771204. Reply with this code to confirm order #1037.", credits: 1, status: "failed", gateway: "BulkSMSBD", error: "1003 — Invalid sender ID" },
  { id: "sms_5012", date: "2026-07-11", time: "2:02 PM", name: "Nayeem Uddin", phone: "8801512345689", type: "abandoned", message: "Still thinking it over, Nayeem Uddin? Use code COMEBACK10 for a discount. Complete your order: https://bdsms.link/r/pq34rs", credits: 2, status: "delivered", gateway: "BulkSMSBD", error: null },
  { id: "sms_5013", date: "2026-07-10", time: "5:55 PM", name: "Rakib Hasan", phone: "8801712345678", type: "order", message: "Dear Rakib Hasan, order #1035 has been delivered. Thank you for shopping with Dhaka Fashion.", credits: 1, status: "delivered", gateway: "BulkSMSBD", error: null },
  { id: "sms_5014", date: "2026-07-10", time: "2:15 PM", name: "Farhana Akter", phone: "8801312345683", type: "manual", message: "আপনার অর্ডারটি প্রস্তুত। আজ বিকেলে ডেলিভারি করা হবে।", credits: 1, status: "delivered", gateway: "BulkSMSBD", error: null },
  { id: "sms_5015", date: "2026-07-10", time: "10:30 AM", name: "Unknown", phone: "8801112345690", type: "manual", message: "Test message from Dhaka Fashion.", credits: 1, status: "failed", gateway: "BulkSMSBD", error: "1004 — Invalid number format" },
];
