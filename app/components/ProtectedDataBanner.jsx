import {
  PROTECTED_DATA_HEADING,
  PROTECTED_DATA_HELP_URL,
  PROTECTED_DATA_MESSAGE,
} from "../lib/protected-data";

/**
 * Shown when Shopify refuses to return customer data. Every page that reads
 * customers renders this same banner, so the merchant gets one explanation and
 * one place to fix it rather than a different GraphQL error on each screen.
 */
export function ProtectedDataBanner() {
  return (
    <s-banner tone="critical" heading={PROTECTED_DATA_HEADING}>
      <s-paragraph>{PROTECTED_DATA_MESSAGE}</s-paragraph>
      <s-paragraph>
        The same approval governs the phone numbers on your webhook payloads, so
        until it is granted, order automations and COD verification will also have
        nothing to send to.
      </s-paragraph>
      <s-link href={PROTECTED_DATA_HELP_URL} target="_blank">
        How protected customer data works
      </s-link>
    </s-banner>
  );
}
