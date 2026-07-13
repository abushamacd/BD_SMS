import { fail, networkFailure, ok, request } from "./contract.js";

// BulkSMSBD — https://bulksmsbd.com/bulksms-api-bangladesh.php
//
// VERIFIED: the endpoint, parameters and response codes below are from the
// official docs, and the live endpoint was called during development (an empty
// request returns {"response_code":1003,...}, confirming the JSON shape).
//
//   GET/POST https://bulksmsbd.net/api/smsapi
//   params: api_key, type, number, senderid, message
//   response: { response_code, success_message, error_message }
//
// HTTPS, not the http:// in their docs — phone numbers must be encrypted in
// transit (Shopify protected customer data).

const SEND_URL = "https://bulksmsbd.net/api/smsapi";
const BALANCE_URL = "https://bulksmsbd.net/api/getBalanceApi";

const SUCCESS = 202;

// Whether a code is worth retrying. Anything not listed here is treated as
// permanent — see contract.js for why that default is the safe one.
const RETRYABLE = new Set([
  1005, // internal error at the gateway
  1006, // balance validity unavailable — transient at their end
]);

const MESSAGES = {
  202: "SMS submitted successfully",
  1001: "Invalid number",
  1002: "Sender ID is invalid or disabled",
  1003: "Required fields are missing",
  1005: "Internal error at the gateway",
  1006: "Balance validity unavailable",
  1007: "Insufficient balance at BulkSMSBD",
  1011: "User ID not found",
  1012: "Masking SMS must be sent in Bangla",
  1013: "No gateway found for this sender ID and API key",
  1014: "Sender type not found",
  1015: "No valid gateway found for this sender ID",
  1016: "No active price info for this sender type",
  1017: "No price info for this sender type",
  1018: "Account is disabled",
  1019: "Account pricing is disabled",
  1020: "Parent account not found",
  1021: "No active price for the parent account",
  1031: "Account is not verified",
  1032: "This IP is not whitelisted at BulkSMSBD",
};

function interpret(json, text) {
  const code = Number(json?.response_code);

  if (!Number.isFinite(code)) {
    // Unparseable response — could be an outage page or a captive portal.
    return fail("BAD_RESPONSE", `Unexpected response from BulkSMSBD: ${text.slice(0, 120)}`, {
      retryable: true,
      raw: text,
    });
  }

  if (code === SUCCESS) {
    // BulkSMSBD's smsapi does not return a per-message id, so delivery reports
    // must be matched another way. Nothing to store here.
    return ok(null, json);
  }

  return fail(code, MESSAGES[code] ?? json?.error_message ?? `BulkSMSBD error ${code}`, {
    retryable: RETRYABLE.has(code),
    raw: json,
  });
}

export function createBulkSmsBdAdapter({ apiKey, senderId }) {
  return {
    provider: "BULKSMSBD",

    async send({ phone, message, senderId: overrideSenderId }) {
      const params = new URLSearchParams({
        api_key: apiKey,
        type: "text",
        number: phone,
        senderid: overrideSenderId || senderId || "",
        message,
      });

      try {
        // POST, not GET: a GET puts the API key and the customer's phone number
        // in the URL, where it lands in access logs and proxies.
        const { text, json } = await request(SEND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });

        return interpret(json, text);
      } catch (error) {
        return networkFailure(error);
      }
    },

    async testConnection() {
      try {
        const { text, json } = await request(BALANCE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ api_key: apiKey }).toString(),
        });

        const code = Number(json?.response_code);

        if (code === SUCCESS || json?.balance !== undefined) {
          const balance = json?.balance ?? json?.success_message ?? null;
          return {
            ok: true,
            message: "Connected to BulkSMSBD.",
            balance: balance ? String(balance) : null,
          };
        }

        return {
          ok: false,
          message: MESSAGES[code] ?? `BulkSMSBD rejected the credentials: ${text.slice(0, 120)}`,
          balance: null,
        };
      } catch (error) {
        return {
          ok: false,
          message: `Could not reach BulkSMSBD: ${error.message}`,
          balance: null,
        };
      }
    },
  };
}
