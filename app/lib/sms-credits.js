// SMS segmentation and credit cost.
//
// An SMS is not "one message" — carriers bill per 140-byte segment, and the
// encoding decides how much text fits in one. This is the difference that
// matters for Bangladesh:
//
//   GSM-7   (English)  160 chars alone, 153 per part when split
//   UCS-2   (Bangla)    70 chars alone,  67 per part when split
//
// So a 100-character message costs 1 credit in English and 2 in Bangla, and a
// single Bangla character anywhere in an otherwise-English message forces the
// whole message to UCS-2 and roughly halves its capacity. Merchants are
// repeatedly surprised by this, which is why the counter is shown live.
//
// Used by both the settings UI (live preview) and the send pipeline (billing),
// so the number a merchant sees is the number they are charged.

// GSM 03.38 basic character set — 1 septet each.
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);

// GSM 03.38 extension table — these cost 2 septets, not 1.
const GSM7_EXTENDED = new Set("^{}\\[~]|€\f");

const GSM7_SINGLE = 160;
const GSM7_MULTI = 153;
const UCS2_SINGLE = 70;
const UCS2_MULTI = 67;

export function isGsm7(text) {
  for (const char of text) {
    if (!GSM7_BASIC.has(char) && !GSM7_EXTENDED.has(char)) return false;
  }
  return true;
}

// Cost of each character in the units of its encoding.
function unitCost(char, gsm7) {
  if (gsm7) return GSM7_EXTENDED.has(char) ? 2 : 1;
  // UCS-2 counts UTF-16 code units, so astral characters (most emoji) cost 2.
  return char.length;
}

// Split into parts without ever breaking a character across a segment
// boundary — a 2-unit character that doesn't fit is pushed to the next part,
// which is why this counts greedily instead of dividing.
function countParts(chars, gsm7, perPart) {
  let parts = 1;
  let used = 0;

  for (const char of chars) {
    const cost = unitCost(char, gsm7);
    if (used + cost > perPart) {
      parts += 1;
      used = cost;
    } else {
      used += cost;
    }
  }

  return parts;
}

/**
 * Segment a message and price it.
 *
 * @param {string} text The exact message that will be sent (variables already
 *   substituted — an unrendered `{{customer_name}}` is not what gets billed).
 * @returns {{encoding: string, isUnicode: boolean, characters: number,
 *   units: number, parts: number, credits: number, unitsPerPart: number,
 *   remaining: number}}
 */
export function segmentSms(text = "") {
  const chars = [...text];
  const gsm7 = isGsm7(text);

  const units = chars.reduce((sum, char) => sum + unitCost(char, gsm7), 0);
  const single = gsm7 ? GSM7_SINGLE : UCS2_SINGLE;
  const multi = gsm7 ? GSM7_MULTI : UCS2_MULTI;

  const parts = units === 0 ? 0 : units <= single ? 1 : countParts(chars, gsm7, multi);

  const unitsPerPart = parts <= 1 ? single : multi;
  const capacity = parts <= 1 ? single : multi * parts;

  return {
    encoding: gsm7 ? "GSM-7" : "Unicode",
    isUnicode: !gsm7,
    characters: chars.length,
    units,
    parts,
    // Gateways bill one credit per part.
    credits: parts,
    unitsPerPart,
    remaining: Math.max(0, capacity - units),
  };
}

/** Replace {{variables}} with values. Unknown variables are left visible. */
export function renderTemplate(template = "", values = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
}
