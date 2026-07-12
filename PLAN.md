# BD SMS — Build Plan

Shopify SMS marketing & automation app for Bangladesh.

**Stack:** Shopify App Template (React Router 7) · Polaris web components · Prisma · MySQL (XAMPP local) · Node worker
**Distribution:** Public Shopify App Store
**Approach:** Build the entire UI first with mock data, then wire the backend behind it.

---

## Phase 0 — Project setup

1. Switch Prisma datasource from SQLite to **MySQL** (`provider = "mysql"`, `DATABASE_URL="mysql://root:@localhost:3306/bd_sms"`). Create the `bd_sms` database in phpMyAdmin.
2. Strip the template demo: delete `app.additional.jsx`, the product-generator code in `app._index.jsx`, and the demo metafield/metaobject blocks in `shopify.app.toml`.
3. Set real access scopes: `read_orders`, `write_orders` (COD order tagging), `read_fulfillments`, `read_customers`, `read_checkouts`, `read_products`.
4. `.env` for gateway keys + encryption secret.
5. **Parallel admin task:** apply for **Protected Customer Data** access (Level 2) in the Partner Dashboard — required to read customer phone numbers in production. Approval comes *after* review, so submit early and keep building.
   → Step-by-step guide with copy-paste justifications: [`docs/protected-customer-data.md`](docs/protected-customer-data.md)

---

## Phase 1 — UI (mock data, no backend)

Every page built with Polaris web components, fed by hardcoded mock data so the whole app is clickable and reviewable before any backend exists.

### 1.1 App shell
Nav: Dashboard · Send SMS · Campaigns · Abandoned Cart · SMS Log · Settings · Billing

### 1.2 Dashboard
- Credit balance card + low-balance warning
- Stat tiles: SMS sent today / this month, delivery rate, credits spent
- Recent SMS activity list
- Feature status at a glance (which automations are on/off)
- Abandoned-cart recovery summary (sent → recovered → revenue)

### 1.3 Settings — feature toggles + templates
One card per feature, each with an enable/disable switch and an editable message template:
- New Order SMS
- Order Fulfillment SMS
- Order Shipment SMS
- Order Delivery SMS
- Order Cancelled SMS
- COD OTP Verification SMS
- Abandoned Cart SMS

Each template editor includes:
- Variable inserter: `{{customer_name}}` `{{order_number}}` `{{order_total}}` `{{tracking_url}}` `{{shop_name}}` `{{otp_code}}` `{{recovery_url}}`
- **Live credit counter** — English (GSM-7) = 160 chars/SMS, Bangla (Unicode) = **70 chars/SMS**. Shows character count, parts, and credits per send.
- **Send test SMS** button
- Global settings: sender ID, quiet hours (don't send 10pm–8am), default country code (+880)

### 1.4 Send SMS page
- Customer picker (search + multi-select, with a "select all" filter by tag/order count)
- Or paste/upload a raw phone number list
- Message box with the same live credit counter
- Cost preview: `N recipients × M credits = X credits total`
- Confirm & send screen

### 1.5 Campaigns
- **List view:** name, status (draft/scheduled/sending/paused/completed), recipients, sent, delivered, credits used
- **Create campaign:** name → audience segment (all customers / SMS-consented only / by tag / by order count / by last-order date) → message + credit preview → send now or schedule for later
- **Campaign detail:** live progress bar, pause / resume / cancel, per-recipient delivery status
- Consent notice: marketing SMS only goes to customers with SMS marketing consent

### 1.6 Abandoned Cart
- List of abandoned checkouts: customer, phone, cart value, time abandoned, SMS status, recovered yes/no
- Settings: delay before sending (e.g. 1h / 6h / 24h), up to 3 follow-up messages
- Optional **discount code** attached to the recovery SMS (biggest lever on recovery rate)
- Manual "Send SMS" button per row
- Recovery stats: sent / clicked / recovered / revenue

### 1.7 SMS Log
- Table: date & time, receiver name, phone number, message body, type (order/campaign/OTP/abandoned/manual), credits used, status (queued/sent/delivered/failed), gateway
- Filters: date range, type, status, phone search
- Export to CSV
- Failed messages show the gateway error reason

### 1.8 Billing
- **Subscription page** — for merchants using their own SMS gateway. Plan cards, current plan, upgrade/cancel.
- **Recharge page** — for merchants on the default gateway. Credit packages, purchase history, current balance, auto-recharge threshold.
- Both go through the **Shopify Billing API** (required for App Store apps).

### 1.9 Gateway settings
- Choose: Default gateway (buy credits from us) OR Personal gateway (subscription required)
- Personal gateway config: preset picker (BulkSMSBD / MiMSMS / SSL Wireless / Generic HTTP) + API key, sender ID, URL template
- "Test connection" button

### 1.10 Blacklist / opt-out
- List of numbers that replied STOP or were manually blocked
- Manual add/remove

---

## Phase 2 — Backend: SMS core

The heart of the app — everything else depends on this.

1. **Data model** (Prisma/MySQL): `ShopSettings`, `Gateway`, `CreditLedger`, `MessageTemplate`, `SmsLog`, `Job`, `Campaign`, `CampaignRecipient`, `AbandonedCheckout`, `CodOtp`, `Blacklist`
2. **Gateway adapter interface** — one common `send()` contract, four implementations (BulkSMSBD, MiMSMS, SSL Wireless, Generic HTTP). Credentials encrypted at rest.
3. **BD phone normalization** — `01XXXXXXXXX` → `8801XXXXXXXXX`, operator prefix validation, reject invalid numbers before they burn credits.
4. **Credit calculator** — GSM-7 vs Unicode detection, 160/70 char part splitting, credit cost per message.
5. **Send pipeline** — check feature enabled → check blacklist/consent → normalize phone → calculate credits → atomically debit ledger → call gateway → write `SmsLog` row.
6. **DB-backed job queue + worker** — polls `Job` table, rate-limited sending, exponential-backoff retries, respects quiet hours.

---

## Phase 3 — Backend: order automations

- Webhooks: `orders/create`, `orders/fulfilled`, `fulfillments/create`, `fulfillments/update`, `orders/cancelled`
- Template rendering with real order/customer variables
- **COD OTP flow** — Shopify checkout cannot be blocked, so this is a *post-order confirmation*:
  order placed with COD → send OTP/confirm-link SMS → customer confirms on a public page → order tagged `cod-confirmed`, otherwise `cod-unconfirmed`. Merchant ships only confirmed orders.

---

## Phase 4 — Backend: campaigns & abandoned cart

- Campaign execution through the job queue: audience query → recipient rows → rate-limited send → live progress → pause/resume/cancel
- Abandoned checkout: `checkouts/create` + `checkouts/update` webhooks → store → delay timer → if no matching order, send recovery SMS with `recovery_url` (+ optional discount code) → mark recovered when an order arrives

---

## Phase 5 — Backend: billing

- Shopify Billing API: `appSubscriptionCreate` (personal-gateway plans) and `appPurchaseOneTime` (credit packages)
- Credit ledger accounting for both modes: default-gateway shops burn purchased credits, personal-gateway shops burn their own gateway's balance
- Low-balance alerts + optional auto-recharge

---

## Phase 6 — Launch requirements

- Mandatory GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact`
- **DLR callbacks** — public endpoint per gateway so delivery status updates the log (otherwise every message reads "sent" even if it never arrived)
- Opt-out/STOP handling → auto-blacklist
- Short links for tracking URLs (long URLs push messages into extra credits)
- Analytics page: credits by feature, delivery rate, recovery revenue
- App Store listing, screenshots, privacy policy, pricing page
- Migrate MySQL off XAMPP to managed hosting

---

## Key constraints (do not design around these — design *for* them)

| Constraint | Consequence |
|---|---|
| Shopify checkout cannot be blocked | COD OTP is post-order confirmation, not pre-checkout |
| Carts have no phone number | v1 abandoned cart = abandoned *checkout* only |
| App Store requires Shopify Billing | No direct bKash/Nagad payments in-app |
| Phone = Protected Customer Data | Needs Level 2 approval or phones return null in production |
| Bangla is Unicode | 70 chars per SMS part, not 160 — credit math must handle it |
| Marketing SMS needs consent | Campaigns filter on `smsMarketingConsent`; transactional is exempt |
