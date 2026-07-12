import { segmentSms } from "../lib/sms-credits";

/**
 * Live encoding + cost readout for a message. Shared by Settings, Send SMS and
 * Campaigns so every screen quotes the same price for the same text.
 *
 * `text` must be the message as it will actually be sent — variables already
 * substituted.
 */
export function CreditCounter({ text, recipients }) {
  const { encoding, isUnicode, characters, parts, credits, unitsPerPart, remaining } =
    segmentSms(text);

  const total = typeof recipients === "number" ? credits * recipients : null;

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

      {isUnicode ? (
        <s-text color="subdued">
          Bangla is sent as Unicode, so only {unitsPerPart} characters fit in one
          SMS part instead of 160.
        </s-text>
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
