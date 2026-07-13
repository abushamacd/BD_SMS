// The gateway contract.
//
// Every provider speaks a different dialect — GET query strings, JSON POSTs,
// numeric response codes, string statuses. The send pipeline must not care.
// Each adapter maps its provider onto exactly this shape:
//
//   send({ phone, message, senderId, reference }) -> SendResult
//   testConnection()                              -> TestResult
//
// The single most important thing an adapter decides is `retryable`. Retrying a
// permanent failure (invalid number, bad sender ID) wastes a credit every time
// and never succeeds. NOT retrying a transient failure (network blip, provider
// 500) loses a message the merchant paid for. When a provider gives us an
// unrecognised code we default to NOT retryable, because a message that quietly
// stops is cheaper to recover from than one that retries forever.

/**
 * @typedef {object} SendResult
 * @property {boolean} ok
 * @property {string|null} providerMessageId  Provider's id, used to match delivery reports.
 * @property {string|null} errorCode          Provider's raw code, kept for support.
 * @property {string|null} errorMessage       Human-readable, shown in the SMS log.
 * @property {boolean} retryable              Whether the queue should try again.
 * @property {any} raw                        Untouched provider response, for debugging.
 */

/**
 * @typedef {object} TestResult
 * @property {boolean} ok
 * @property {string} message
 * @property {string|null} balance  Provider-side balance, when the provider exposes it.
 */

export function ok(providerMessageId, raw) {
  return {
    ok: true,
    providerMessageId: providerMessageId ?? null,
    errorCode: null,
    errorMessage: null,
    retryable: false,
    raw,
  };
}

export function fail(errorCode, errorMessage, { retryable = false, raw = null } = {}) {
  return {
    ok: false,
    providerMessageId: null,
    errorCode: errorCode ? String(errorCode) : null,
    errorMessage,
    retryable,
    raw,
  };
}

/** Network failures and 5xx are the transient class — always worth retrying. */
export function networkFailure(error) {
  const isTimeout = error?.name === "AbortError" || error?.name === "TimeoutError";

  return fail(
    isTimeout ? "TIMEOUT" : "NETWORK",
    isTimeout
      ? "The gateway did not respond in time."
      : `Could not reach the gateway: ${error?.message ?? "unknown error"}`,
    { retryable: true, raw: null },
  );
}

const TIMEOUT_MS = 15_000;

/**
 * fetch with a hard timeout. Without this a hung provider ties up a worker
 * slot indefinitely and the whole queue stalls behind it.
 */
export async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Several BD gateways return bare text on error. Keep the raw body.
    }

    return { response, text, json };
  } finally {
    clearTimeout(timer);
  }
}
