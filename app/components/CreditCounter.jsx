import {
  MAX_PARTS,
  findUnicodeForcingCharacters,
  fixAccidentalUnicode,
  segmentSms,
} from "../lib/sms-credits";

/**
 * Live encoding + cost readout for a message. Shared by Settings, Send SMS,
 * Campaigns and Abandoned Cart so every screen quotes the same price for the
 * same text — and the send pipeline charges from the same module.
 *
 * `text` must be the message as it will actually be sent, with variables already
 * substituted.
 *
 * Pass `onFix` to let the merchant one-click repair typographic characters that
 * accidentally force Unicode.
 */
export function CreditCounter({ text, recipients, onFix }) {
  const { encoding, isUnicode, characters, parts, credits, unitsPerPart, remaining } =
    segmentSms(text);

  const total = typeof recipients === "number" ? credits * recipients : null;

  // Only meaningful for otherwise-English messages: Bangla has no GSM-7 form,
  // so there is nothing to fix and this returns [].
  const forcing = findUnicodeForcingCharacters(text);
  const repair = forcing.length > 0 ? fixAccidentalUnicode(text) : null;
  const savesCredits = repair && repair.after.credits < repair.before.credits;

  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-badge tone={isUnicode ? "caution" : "neutral"}>{encoding}</s-badge>
        <s-text color="subdued">
          {characters} characters · {parts} SMS {parts === 1 ? "part" : "parts"} ·{" "}
          <s-text type="strong">
            {credits} {credits === 1 ? "credit" : "credits"}
          </s-text>{" "}
          per recipient · {remaining} left in this part
        </s-text>
      </s-stack>

      {isUnicode && forcing.length === 0 ? (
        <s-text color="subdued">
          Bangla is sent as Unicode, so only {unitsPerPart} characters fit in one
          SMS part instead of 160.
        </s-text>
      ) : null}

      {forcing.length > 0 ? (
        <s-banner
          tone={savesCredits ? "warning" : "info"}
          heading={
            savesCredits
              ? `These characters are ${repair.before.credits - repair.after.credits} extra credit(s) per message`
              : "These characters force Unicode encoding"
          }
        >
          <s-paragraph>
            {forcing
              .map((entry) =>
                entry.char.trim() === ""
                  ? `an invisible character (U+${entry.char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")})`
                  : `"${entry.char}"`,
              )
              .join(", ")}{" "}
            {forcing.length === 1 ? "is" : "are"} not in the plain SMS alphabet, so
            the whole message is sent as Unicode — which fits only 70 characters
            per part instead of 160. Word and Google Docs insert these
            automatically.
          </s-paragraph>

          {onFix ? (
            <s-button slot="primary-action" onClick={() => onFix(repair.text)}>
              Replace with plain text
              {savesCredits
                ? ` (${repair.after.credits} credit${repair.after.credits === 1 ? "" : "s"} instead of ${repair.before.credits})`
                : ""}
            </s-button>
          ) : null}
        </s-banner>
      ) : null}

      {parts > MAX_PARTS ? (
        <s-banner tone="critical" heading="This message is too long to send">
          <s-paragraph>
            It splits into {parts} SMS parts. Most gateways refuse more than{" "}
            {MAX_PARTS}, and a message this long is usually a mistake — check for
            a variable that did not fill in.
          </s-paragraph>
        </s-banner>
      ) : null}

      {total !== null ? (
        <s-text>
          <s-text type="strong">
            {recipients.toLocaleString()} recipients × {credits}{" "}
            {credits === 1 ? "credit" : "credits"} = {total.toLocaleString()} credits
          </s-text>
        </s-text>
      ) : null}
    </s-stack>
  );
}
