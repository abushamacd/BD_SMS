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

/**
 * @returns {{valid: boolean, e164: string|null, national: string|null,
 *   operator: string|null, input: string, reason: string|null}}
 */
export function normalizeBdPhone(input) {
  const raw = String(input ?? "").trim();
  const fail = (reason) => ({
    valid: false,
    e164: null,
    national: null,
    operator: null,
    input: raw,
    reason,
  });

  if (!raw) return fail("Empty");

  // Bengali numerals (০১২৩৪৫৬৭৮৯) arrive from Bangla spreadsheets and phone
  // contacts. Fold them to ASCII before anything else looks at the string.
  const ascii = raw.replace(/[০-৯]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x09e6),
  );

  // Strip everything that isn't a digit: spaces, dashes, brackets, leading +.
  let digits = ascii.replace(/\D/g, "");

  if (!digits) return fail("No digits");

  // Peel off the country code in any of the forms it arrives in.
  if (digits.startsWith("880")) {
    digits = digits.slice(3);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  // What remains should be the 10-digit national number: 1[3-9] + 8 digits.

  if (digits.length !== 10) {
    return fail(
      digits.length < 10 ? "Too short — expected 11 digits" : "Too long — expected 11 digits",
    );
  }

  if (!digits.startsWith("1")) return fail("Not a mobile number");

  const operator = OPERATORS[digits.slice(0, 2)];
  if (!operator) return fail(`Unknown operator prefix 0${digits.slice(0, 2)}`);

  return {
    valid: true,
    e164: `880${digits}`,
    national: `0${digits}`,
    operator,
    input: raw,
    reason: null,
  };
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
