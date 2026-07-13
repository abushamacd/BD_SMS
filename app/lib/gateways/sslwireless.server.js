import { fail, networkFailure, ok, request } from "./contract.js";

// SSL Wireless (SMS Plus v3)
//
// UNVERIFIED — READ THIS BEFORE TRUSTING IT.
//
// SSL Wireless publishes its API behind a customer login, so the request shape
// below could not be confirmed against an authoritative source during
// development. It reflects the widely-used v3 contract:
//
//   POST https://smsplus.sslwireless.com/api/v3/send-sms
//   body: { api_token, sid, msisdn, sms, csms_id }
//   success: { status: "SUCCESS", status_code: 200, ... }
//
// Note SSL Wireless also operates an older `pushapi` (user/pass, GET, Bangla
// hex-encoded) which is a DIFFERENT API. This adapter targets v3.
//
// Confirm with real credentials via "Test connection" before a merchant sends
// anything through it. If a field name is wrong, it is a small fix here and
// nowhere else — that is the point of the adapter boundary.

const SEND_URL = "https://smsplus.sslwireless.com/api/v3/send-sms";

function interpret(json, text) {
  const status = String(json?.status ?? "").toUpperCase();
  const statusCode = Number(json?.status_code);

  if (status === "SUCCESS" || statusCode === 200) {
    // csms_id echoes back; the provider's own reference is what a DLR carries.
    const messageId =
      json?.smsinfo?.[0]?.sms_id ?? json?.sms_id ?? json?.csms_id ?? null;

    return ok(messageId, json);
  }

  const message =
    json?.error_message ?? json?.message ?? (text ? text.slice(0, 160) : "SSL Wireless rejected the message");

  const retryable = Number.isFinite(statusCode) && statusCode >= 500;

  return fail(json?.status_code ?? status ?? "SSL_ERROR", message, {
    retryable,
    raw: json ?? text,
  });
}

export function createSslWirelessAdapter({ apiKey, senderId }) {
  return {
    provider: "SSLWIRELESS",

    async send({ phone, message, senderId: overrideSenderId, reference }) {
      try {
        const { text, json } = await request(SEND_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            api_token: apiKey,
            sid: overrideSenderId || senderId || "",
            msisdn: phone,
            sms: message,
            // Our own unique id for this message. SSL Wireless uses it to
            // de-duplicate, so a retried send must reuse the same value or the
            // customer gets the message twice.
            csms_id: reference,
          }),
        });

        return interpret(json, text);
      } catch (error) {
        return networkFailure(error);
      }
    },

    async testConnection() {
      // No balance endpoint we can rely on without documentation. Send nothing;
      // just check whether the credentials are accepted.
      try {
        const { text, json } = await request(SEND_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            api_token: apiKey,
            sid: senderId || "",
            msisdn: "",
            sms: "",
            csms_id: `test-${Date.now()}`,
          }),
        });

        const message = json?.error_message ?? json?.message ?? text.slice(0, 160);
        const looksLikeAuthFailure = /token|auth|unauthor|invalid.*(api|sid)/i.test(
          message ?? "",
        );

        if (looksLikeAuthFailure) {
          return { ok: false, message, balance: null };
        }

        return {
          ok: true,
          message: "SSL Wireless accepted these credentials.",
          balance: null,
        };
      } catch (error) {
        return {
          ok: false,
          message: `Could not reach SSL Wireless: ${error.message}`,
          balance: null,
        };
      }
    },
  };
}
