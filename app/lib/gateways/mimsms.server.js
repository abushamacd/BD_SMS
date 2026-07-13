import { fail, networkFailure, ok, request } from "./contract.js";

// MiMSMS — https://apidoc.mimsms.com/
//
// PARTIALLY VERIFIED. MiMSMS's documentation is JavaScript-rendered and could
// not be fetched directly during development. The request shape below comes
// from their published API reference:
//
//   POST https://api.mimsms.com/api/SmsSending/SMS
//   body: { UserName, Apikey, MobileNumber, SenderName, TransactionType, Message }
//   success: { statusCode: "200", status: "Success", trxnId, responseResult }
//
// The error response shape is NOT confirmed, so interpret() below treats
// anything that is not an explicit success as a failure and surfaces whatever
// the provider said. Run "Test connection" with real credentials before relying
// on this adapter — that is what will confirm it.

const SEND_URL = "https://api.mimsms.com/api/SmsSending/SMS";

// T = transactional, P = promotional. Operators route these differently and
// promotional traffic is blocked during DND hours, so campaigns must not be
// sent as transactional just to get better delivery.
export const TRANSACTION_TYPE = { TRANSACTIONAL: "T", PROMOTIONAL: "P" };

function interpret(json, text) {
  const status = String(json?.status ?? "").toLowerCase();
  const statusCode = String(json?.statusCode ?? "");

  if (status === "success" || statusCode === "200") {
    return ok(json?.trxnId ?? null, json);
  }

  const message =
    json?.responseResult ?? json?.message ?? (text ? text.slice(0, 160) : "MiMSMS rejected the message");

  // 5xx from the provider is transient; anything else is assumed permanent.
  const retryable = statusCode.startsWith("5");

  return fail(statusCode || "MIMSMS_ERROR", message, { retryable, raw: json ?? text });
}

export function createMiMsmsAdapter({ apiKey, username, senderId }) {
  const call = async (message, phone, senderName, transactionType) => {
    const { text, json } = await request(SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        UserName: username,
        Apikey: apiKey,
        MobileNumber: phone,
        SenderName: senderName,
        TransactionType: transactionType,
        Message: message,
      }),
    });

    return interpret(json, text);
  };

  return {
    provider: "MIMSMS",

    async send({ phone, message, senderId: overrideSenderId, promotional = false }) {
      try {
        return await call(
          message,
          phone,
          overrideSenderId || senderId || "",
          promotional ? TRANSACTION_TYPE.PROMOTIONAL : TRANSACTION_TYPE.TRANSACTIONAL,
        );
      } catch (error) {
        return networkFailure(error);
      }
    },

    async testConnection() {
      // MiMSMS exposes no documented balance endpoint we could verify, so the
      // only honest test is to check that the credentials are accepted. We do
      // that without sending: an empty MobileNumber is rejected for a bad key
      // differently than for a bad number.
      try {
        const result = await call("", "", senderId || "", TRANSACTION_TYPE.TRANSACTIONAL);

        // An auth failure means the credentials are wrong. Any other rejection
        // (e.g. "invalid number") means the credentials were accepted.
        const looksLikeAuthFailure = /auth|api\s*key|username|unauthor/i.test(
          result.errorMessage ?? "",
        );

        if (looksLikeAuthFailure) {
          return { ok: false, message: result.errorMessage, balance: null };
        }

        return {
          ok: true,
          message: "MiMSMS accepted these credentials.",
          balance: null,
        };
      } catch (error) {
        return {
          ok: false,
          message: `Could not reach MiMSMS: ${error.message}`,
          balance: null,
        };
      }
    },
  };
}
