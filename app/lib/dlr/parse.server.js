// Parsing a delivery report.
//
// Every gateway posts DLRs in its own shape — different field names, different
// status vocabularies, GET query string or POST body — so each provider gets its
// own parser here. They all return the same normalised shape:
//
//   { providerMessageId, phone, status, reason, permanent }
//
//   status: "DELIVERED" | "UNDELIVERED" | "PENDING" | null
//     PENDING  — an intermediate report ("in transit"); we ignore it and wait.
//     null     — we could not read the report at all.
//   permanent: for an UNDELIVERED, is this number permanently dead (invalid
//     number, hard block) vs. temporarily unreachable (phone off)? A permanent
//     failure is what earns a place on the blacklist — there is no point paying
//     to text that number again.
//
// A parser NEVER decides money. It reads a status string; apply.server.js does
// the rest, and by design a DLR can only change how a message is displayed, never
// what it cost.

function pick(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

/**
 * BulkSMSBD.
 *
 * The hard one. BulkSMSBD's send API returns no per-message id, so we have
 * nothing to match a report against except the phone number — see the matcher in
 * apply.server.js. Their DLR posts `status` as a word.
 * https://bulksmsbd.net — delivery report fields.
 */
function parseBulkSmsBd(fields) {
  const raw = pick(fields, ["status", "Status", "dlr", "DLR"]);
  const phone = pick(fields, ["to", "msisdn", "number", "Number", "mobile"]);
  const providerMessageId = pick(fields, ["message_id", "messageId", "request_id"]);

  const status = mapWord(raw);

  return {
    providerMessageId,
    phone,
    status: status.status,
    reason: raw,
    permanent: status.permanent,
  };
}

/**
 * MiMSMS. Returns a transaction id (`trxnId`) at send, which comes back on the
 * report — so this one matches cleanly by id.
 */
function parseMiMsms(fields) {
  const raw = pick(fields, ["status", "Status", "deliveryStatus"]);
  const providerMessageId = pick(fields, ["trxnId", "TrxnId", "transactionId", "messageId"]);
  const phone = pick(fields, ["mobile", "msisdn", "number", "to"]);

  const status = mapWord(raw);

  return { providerMessageId, phone, status: status.status, reason: raw, permanent: status.permanent };
}

/**
 * SSL Wireless. We send a reference and it dedupes on it; the DLR carries the
 * same id back. Statuses are their v3 vocabulary.
 */
function parseSslWireless(fields) {
  const raw = pick(fields, ["status", "Status", "delivery_status"]);
  const providerMessageId = pick(fields, ["reference", "sms_id", "message_id", "referenceId"]);
  const phone = pick(fields, ["msisdn", "mobile", "number", "to"]);

  const status = mapWord(raw);

  return { providerMessageId, phone, status: status.status, reason: raw, permanent: status.permanent };
}

/**
 * Generic HTTP. The merchant's provider can post anything, so this is
 * best-effort: we look for the field names providers most commonly use.
 */
function parseGeneric(fields) {
  const raw = pick(fields, ["status", "Status", "dlr", "state", "delivery_status"]);
  const providerMessageId = pick(fields, [
    "message_id", "messageId", "id", "msgid", "reference",
  ]);
  const phone = pick(fields, ["to", "msisdn", "number", "mobile", "phone"]);

  const status = mapWord(raw);

  return { providerMessageId, phone, status: status.status, reason: raw, permanent: status.permanent };
}

// Status words, normalised. Providers spell the same outcomes a dozen ways, and
// most of the vocabulary overlaps, so one shared map covers them and each parser
// only overrides where it must.
//
// The categories that matter:
//   delivered      → DELIVERED
//   hard failures  → UNDELIVERED, permanent (blacklist the number)
//   soft failures  → UNDELIVERED, not permanent (phone off, congestion — retry later)
//   in transit     → PENDING (wait for the next report)
const DELIVERED = /^(deliver|delivrd|delivered|success|dlvrd|dlvd|sent_delivered)/i;
const PERMANENT_FAIL = /(invalid|rejected|blocked|blacklist|do[-_ ]?not[-_ ]?disturb|dnd|no_route|nonexist|unknown_subscriber|absent_permanent|spam)/i;
const SOFT_FAIL = /(undeliv|failed|expired|absent|unavailable|off|congest|error|rejectd|undelivered)/i;
const PENDING = /(pending|queued|accept|enroute|en_route|transit|buffered|sent)/i;

function mapWord(raw) {
  if (!raw) return { status: null, permanent: false };

  const text = String(raw).toLowerCase();

  if (DELIVERED.test(text)) return { status: "DELIVERED", permanent: false };

  // Order matters: "invalid number" is a permanent failure even though it also
  // matches the soft "failed" pattern, so permanent is tested first.
  if (PERMANENT_FAIL.test(text)) return { status: "UNDELIVERED", permanent: true };
  if (SOFT_FAIL.test(text)) return { status: "UNDELIVERED", permanent: false };

  if (PENDING.test(text)) return { status: "PENDING", permanent: false };

  // Something we have never seen. Do NOT guess it is a failure — an unrecognised
  // word must not flip a delivered-looking message to undelivered. Leave it alone
  // and log it, so the vocabulary can be extended.
  return { status: null, permanent: false, unknown: true };
}

const PARSERS = {
  BULKSMSBD: parseBulkSmsBd,
  MIMSMS: parseMiMsms,
  SSLWIRELESS: parseSslWireless,
  GENERIC: parseGeneric,
};

/**
 * @param {string} provider  GatewayProvider (upper-case)
 * @param {object} fields    merged query params + parsed body
 */
export function parseDlr(provider, fields) {
  const parser = PARSERS[provider?.toUpperCase()];

  if (!parser) return null;

  return parser(fields);
}

export function isKnownProvider(provider) {
  return Boolean(PARSERS[provider?.toUpperCase()]);
}
