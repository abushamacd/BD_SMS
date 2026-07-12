# Protected Customer Data — application guide

**Status:** ☐ Not yet submitted
**Where:** Partner Dashboard → Apps → BD SMS → **API access requests** → *Protected customer data access*
**Why it matters:** phone number is Level 2 protected data. Without approval, Shopify **redacts phone numbers from API responses in production** — every feature in this app stops working. Dev stores still return real data, so this failure only appears at launch. Submit early; approval comes after review, not before.

---

## 1. Which fields to request

Request **only these two**. Requesting fields you don't use is a common rejection reason, and every extra field adds scrutiny.

| Field | Level | Request? | Why |
|---|---|---|---|
| **Phone** | 2 | ✅ Yes | The app cannot send SMS without it. Core function. |
| **Name** | 2 | ✅ Yes | Personalises messages (`{{customer_name}}`) and identifies the recipient in the SMS log. |
| Email | 2 | ❌ No | We don't send email. |
| Address | 2 | ❌ No | We don't ship anything. |

If you later add email fallback or address-based features, you must submit a new request.

---

## 2. Justifications (copy-paste, then edit to sound like you)

**Overall app usage — why you need protected customer data**

> BD SMS is an SMS marketing and order-notification app for Shopify merchants in Bangladesh. It sends transactional SMS (order confirmation, fulfillment, shipment, delivery), verifies cash-on-delivery orders by SMS OTP, recovers abandoned checkouts, and lets merchants send opt-in SMS campaigns. Delivering an SMS to a customer requires that customer's phone number; there is no way to provide the app's core function without it. We process only the customer phone number and name, only for merchants who have installed the app, and only to deliver messages the merchant has configured or explicitly initiated.

**Phone**

> Required to deliver SMS. The phone number is the delivery address for every message the app sends: order status notifications, cash-on-delivery OTP verification, abandoned checkout recovery, and merchant-initiated campaigns. Without the phone number the app has no function. We use it solely as the SMS destination and never share, sell, or use it for any other purpose.

**Name**

> Used to personalise message content (for example "Dear {{customer_name}}, your order #1234 has been confirmed") and to identify the recipient of each message in the merchant's SMS delivery log, so the merchant can confirm which customer a message was sent to. It is not used for profiling or any automated decision-making.

---

## 3. Data protection details you must be able to answer

The form asks you to attest to these. **Bold** items are things we must actually build — they are engineering requirements, not paperwork.

### Level 1 requirements
- **Encryption in transit** — HTTPS everywhere. Shopify hosting gives us this; our gateway calls must use HTTPS endpoints (note: BulkSMSBD's documented API URL is `http://` — we should use the HTTPS variant).
- **Encryption at rest** — ✅ already started: gateway credentials are AES-256-GCM encrypted via `ENCRYPTION_KEY`. Production database must also have encryption at rest enabled (managed MySQL providers do this by default; **XAMPP does not — this is one reason we cannot ship on XAMPP**).
- **Data minimisation** — only request phone + name. Only store what we send.
- **Purpose limitation** — customer data is used only to deliver SMS the merchant configured. Never sold, never used to train anything, never shared beyond the SMS gateway that delivers the message.
- **Retention policy** — you must state one and honour it. Proposed: *SMS logs retained 12 months, then phone numbers anonymised. Customer records deleted within 30 days of app uninstall.* **We must build this** (a scheduled purge job, Phase 6).
- **Customer consent** — marketing campaigns only go to customers with SMS marketing consent from Shopify. Transactional messages (order status, OTP) are exempt. **We must build this filter** (Phase 4).
- **Opt-out** — customers can reply STOP to unsubscribe and are added to a blacklist that all future sends check. **We must build this** (Phase 6).
- **Merchant transparency + privacy policy** — you need a public privacy policy URL before submitting. Write one.

### Level 2 additional requirements (because we want phone)
- **Encrypted backups** — production DB backups must be encrypted.
- **Separate test and production environments** — dev store + local MySQL must never point at production data. Already true.
- **Restricted staff access** — only people who need production data may access it. If it's just you, say so.
- **Strong passwords / 2FA** — enable 2FA on your Partner account and your hosting.
- **Access logging** — log who accessed customer data and when.
- **Incident response plan** — a written plan for what you do if there's a breach (detect, contain, notify affected merchants and Shopify, remediate). One page is enough, but you must have it.
- **Data loss prevention** — backups, and no exporting customer data to unmanaged places.

---

## 4. Before you submit — checklist

- ☐ Public **privacy policy** URL exists and covers what you collect, why, how long, and how to opt out
- ☐ **Retention policy** decided (12 months proposed above)
- ☐ **Incident response plan** written down (one page)
- ☐ **2FA enabled** on Partner account
- ☐ App requests **only** `read_orders`, `write_orders`, `read_fulfillments`, `read_customers` — no unused scopes
- ☐ Requesting **only phone + name**, not email or address

---

## 5. Consequences for our build (already reflected in PLAN.md)

| Requirement | What it forces |
|---|---|
| Encryption at rest | Production MySQL must be managed + encrypted. XAMPP is local-dev only. |
| Retention policy | Scheduled job to anonymise old SMS logs and purge data on uninstall. |
| Consent | Campaign audience queries filter on `smsMarketingConsent`. |
| Opt-out | STOP handling + blacklist checked on every send. |
| Access logging | Log production access to customer data. |
| HTTPS to gateway | Use HTTPS gateway endpoints, not the documented `http://` ones. |
