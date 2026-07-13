// Bangladeshi phone number normalization.
//
// Merchants paste numbers in every shape imaginable — 01712345678,
// +8801712345678, 8801712345678, 1712345678, with spaces, dashes and stray
// country codes. Gateways want one canonical form (8801XXXXXXXXX), and an
// invalid number still costs a credit when the gateway rejects it. So we
// normalize and validate before anything is queued, not after.
//
// A valid BD mobile number is 01 + operator digit + 8 digits = 11 digits.

const OPERATORS = {
  13: "Grameenphone",
  14: "Banglalink",
  15: "Teletalk",
  16: "Airtel",
  17: "Grameenphone",
  18: "Robi",
  19: "Banglalink",
};

// Machine-readable failure reasons. The send pipeline stores these on skipped
// messages, so "why did this customer never get their SMS" is answerable
// without parsing English.
export const PhoneError = {
  EMPTY: "EMPTY",
  NO_DIGITS: "NO_DIGITS",
  NOT_BANGLADESHI: "NOT_BANGLADESHI",
  TOO_SHORT: "TOO_SHORT",
  TOO_LONG: "TOO_LONG",
  NOT_MOBILE: "NOT_MOBILE",
  UNKNOWN_OPERATOR: "UNKNOWN_OPERATOR",
};

/**
 * @returns {{valid: boolean, e164: string|null, national: string|null,
 *   operator: string|null, input: string, code: string|null, reason: string|null}}
 */
export function normalizeBdPhone(input) {
  const raw = String(input ?? "").trim();
  const fail = (code, reason) => ({
    valid: false,
    e164: null,
    national: null,
    operator: null,
    input: raw,
    code,
    reason,
  });

  if (!raw) return fail(PhoneError.EMPTY, "Empty");

  // Bengali numerals (০১২৩৪৫৬৭৮৯) arrive from Bangla spreadsheets and phone
  // contacts. Fold them to ASCII before anything else looks at the string.
  const ascii = raw.replace(/[০-৯]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x09e6),
  );

  // Strip everything that isn't a digit: spaces, dashes, brackets, leading +.
  let digits = ascii.replace(/\D/g, "");

  if (!digits) return fail(PhoneError.NO_DIGITS, "No digits");

  // Peel the prefixes off, outermost first. They stack in real data — a CSV
  // exported from a phone book quite happily contains "88001712345678", which
  // is country code + the national leading zero, and "008801712345678", which
  // adds the international dial prefix on top. Peeling only one layer (as a
  // naive normalizer does) rejects both, and those are real customers who then
  // silently never receive their order SMS.
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);

  // What remains should be the 10-digit national number: 1[3-9] + 8 digits.

  if (digits.length !== 10) {
    // A wrong-length number that starts with another country's code is a foreign
    // number, not a malformed BD one. Saying so is more useful than "too long".
    const looksForeign = digits.length >= 10 && !digits.startsWith("1");

    if (looksForeign) {
      return fail(
        PhoneError.NOT_BANGLADESHI,
        "Not a Bangladeshi number — this app only sends to +880",
      );
    }

    return digits.length < 10
      ? fail(PhoneError.TOO_SHORT, "Too short — a Bangladeshi mobile number has 11 digits")
      : fail(PhoneError.TOO_LONG, "Too long — a Bangladeshi mobile number has 11 digits");
  }

  if (!digits.startsWith("1")) {
    return fail(PhoneError.NOT_MOBILE, "Not a mobile number — SMS needs 01XXXXXXXXX");
  }

  const operator = OPERATORS[digits.slice(0, 2)];

  if (!operator) {
    return fail(
      PhoneError.UNKNOWN_OPERATOR,
      `0${digits.slice(0, 2)} is not a Bangladeshi mobile prefix`,
    );
  }

  return {
    valid: true,
    e164: `880${digits}`,
    national: `0${digits}`,
    operator,
    input: raw,
    code: null,
    reason: null,
  };
}

/** 8801712345678 → 01712-345678, for display in the UI and the SMS log. */
export function formatBdPhone(input) {
  const result = normalizeBdPhone(input);
  if (!result.valid) return String(input ?? "");

  const national = result.national; // 01712345678
  return `${national.slice(0, 5)}-${national.slice(5)}`;
}

/**
 * Parse a pasted blob of numbers separated by newlines, commas, semicolons or
 * tabs. Returns valid numbers deduplicated by canonical form — the same person
 * written two different ways must not be charged twice.
 */
export function parsePhoneList(text) {
  const tokens = String(text ?? "")
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const valid = [];
  const invalid = [];
  const seen = new Set();
  let duplicates = 0;

  for (const token of tokens) {
    const result = normalizeBdPhone(token);

    if (!result.valid) {
      invalid.push(result);
      continue;
    }

    if (seen.has(result.e164)) {
      duplicates += 1;
      continue;
    }

    seen.add(result.e164);
    valid.push(result);
  }

  return { valid, invalid, duplicates, total: tokens.length };
}
