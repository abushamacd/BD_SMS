import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { SettingsNav } from "../components/SettingsNav";
import {
  DEFAULT_URL_TEMPLATE,
  GATEWAY_MODES,
  HTTP_METHODS,
  PROVIDERS,
  getProvider,
} from "../lib/gateways/providers";
import {
  loadGatewaySettings,
  saveGatewaySettings,
  testGatewayConnection,
} from "../lib/gateways/settings.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Credentials are decrypted only in the send path. What comes back here is a
  // masked hint like "••••zJ31" — never the key itself.
  return await loadGatewaySettings(session.shop);
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();

  if (form.get("intent") === "test") {
    const result = await testGatewayConnection(shop, form);

    return { intent: "test", ...result };
  }

  const result = await saveGatewaySettings(shop, form);

  return { intent: "save", ...result };
};

export default function GatewaySettings() {
  const data = useLoaderData();
  const saveFetcher = useFetcher();
  const testFetcher = useFetcher();
  const shopify = useAppBridge();

  const [form, setForm] = useState({
    mode: data.mode,
    provider: data.provider,
    senderId: data.senderId,
    username: data.username,
    apiKey: "",
    urlTemplate: data.urlTemplate || DEFAULT_URL_TEMPLATE,
    httpMethod: data.httpMethod,
  });

  const saveResult = saveFetcher.data?.intent === "save" ? saveFetcher.data : null;
  const testResult = testFetcher.data?.intent === "test" ? testFetcher.data : null;

  useEffect(() => {
    if (saveResult?.ok) shopify.toast.show("Gateway settings saved");
  }, [saveResult, shopify]);

  const isPersonal = form.mode === "PERSONAL";
  const provider = getProvider(form.provider);

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const body = () => {
    const payload = new FormData();
    payload.set("mode", form.mode);
    payload.set("provider", form.provider);
    payload.set("senderId", form.senderId);
    payload.set("username", form.username);
    payload.set("apiKey", form.apiKey);
    payload.set("urlTemplate", form.urlTemplate);
    payload.set("httpMethod", form.httpMethod);
    return payload;
  };

  const save = () => saveFetcher.submit(body(), { method: "post" });

  const runTest = () => {
    const payload = body();
    payload.set("intent", "test");
    testFetcher.submit(payload, { method: "post" });
  };

  // A saved secret does not have to be retyped — the field is blank because we
  // will not send the key back to the browser, not because it is missing.
  const isFilled = (field) =>
    field.key === "senderId"
      ? Boolean(form.senderId.trim())
      : Boolean(form[field.key]?.trim() || data.secretHints[field.key]);

  const missing = isPersonal ? provider.fields.filter((f) => !isFilled(f)) : [];
  const canTest = isPersonal && missing.length === 0;

  return (
    <s-page heading="SMS gateway">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(saveFetcher.state !== "idle" ? { loading: true } : {})}
      >
        Save
      </s-button>

      <s-section>
        <SettingsNav current="/app/settings/gateway" />
      </s-section>

      {saveResult && !saveResult.ok ? (
        <s-banner tone="critical" heading="These settings could not be saved">
          <s-unordered-list>
            {saveResult.errors.map((error) => (
              <s-list-item key={error}>{error}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      ) : null}

      <s-section heading="How you send">
        <s-stack direction="block" gap="base">
          <s-choice-list
            label="SMS gateway"
            values={[form.mode]}
            onChange={(event) =>
              update({ mode: event.target.values?.[0] ?? event.target.value })
            }
          >
            {GATEWAY_MODES.map((mode) => (
              <s-choice key={mode.value} value={mode.value} details={mode.details}>
                {mode.label}
              </s-choice>
            ))}
          </s-choice-list>

          {isPersonal ? (
            <s-banner tone="warning" heading="A subscription is required">
              <s-paragraph>
                Using your own gateway needs an active app subscription. Your SMS
                credits are then bought from your provider, not from us — nothing
                is debited from your credit balance here.
              </s-paragraph>
              <s-button slot="primary-action" href="/app/billing">
                View plans
              </s-button>
            </s-banner>
          ) : (
            <s-banner tone="info" heading="You are using our gateway">
              <s-paragraph>
                We deliver your messages and you buy credits from us. Nothing to
                configure — top up your balance on the Billing page.
              </s-paragraph>
              <s-button slot="primary-action" href="/app/billing">
                Buy credits
              </s-button>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      {isPersonal ? (
        <s-section heading="Provider">
          <s-stack direction="block" gap="base">
            <s-select
              label="SMS provider"
              value={form.provider}
              onChange={(event) =>
                // Credentials belong to the provider they were issued by, so
                // switching provider clears the typed key rather than carrying a
                // BulkSMSBD key over to an SSL Wireless account.
                update({ provider: event.target.value, apiKey: "", username: "" })
              }
            >
              {PROVIDERS.map((entry) => (
                <s-option key={entry.value} value={entry.value}>
                  {entry.label}
                </s-option>
              ))}
            </s-select>

            {provider.urlEditable ? (
              <s-stack direction="block" gap="base">
                <s-select
                  label="Request method"
                  value={form.httpMethod}
                  onChange={(event) => update({ httpMethod: event.target.value })}
                >
                  {HTTP_METHODS.map((method) => (
                    <s-option key={method.value} value={method.value}>
                      {method.label}
                    </s-option>
                  ))}
                </s-select>

                <s-text-area
                  label="Request URL template"
                  rows={3}
                  value={form.urlTemplate}
                  details="Use {{api_key}}, {{sender_id}}, {{phone}} and {{message}} — we substitute them for each message. The URL must be HTTPS and must not point at a private address."
                  onInput={(event) => update({ urlTemplate: event.target.value })}
                />
              </s-stack>
            ) : (
              <s-url-field
                label="API endpoint"
                value={provider.url}
                details="Set automatically for this provider."
                disabled
              />
            )}

            {provider.fields.map((field) => {
              const Field = field.secret ? "s-password-field" : "s-text-field";
              const hint = data.secretHints[field.key];

              const details = field.secret && hint
                ? `A key is already saved (${hint}). Leave this blank to keep it.`
                : field.details;

              return (
                <Field
                  key={field.key}
                  label={field.label}
                  value={form[field.key] ?? ""}
                  {...(details ? { details } : {})}
                  {...(field.secret && hint ? { placeholder: hint } : {})}
                  onInput={(event) => update({ [field.key]: event.target.value })}
                />
              );
            })}

            <s-banner tone="info" heading="Your credentials are encrypted">
              <s-paragraph>
                API keys are encrypted before they are stored and are only
                decrypted at the moment a message is sent. They are never shown
                back to you or to us in plain text — which is why the field above
                is blank even when a key is saved.
              </s-paragraph>
            </s-banner>

            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button
                onClick={runTest}
                {...(testFetcher.state !== "idle" ? { loading: true } : {})}
                {...(canTest ? {} : { disabled: true })}
              >
                Test connection
              </s-button>
              {!canTest ? (
                <s-text color="subdued">
                  Fill in {missing.length} more{" "}
                  {missing.length === 1 ? "field" : "fields"} to test.
                </s-text>
              ) : null}
              {!testResult && data.lastTest ? (
                <s-text color="subdued">
                  Last test{" "}
                  {data.lastTest.ok ? "succeeded" : `failed: ${data.lastTest.error}`}
                </s-text>
              ) : null}
            </s-stack>

            {testResult ? (
              <s-banner
                tone={testResult.ok ? "success" : "critical"}
                heading={testResult.ok ? "Connection works" : "Connection failed"}
              >
                <s-paragraph>{testResult.message}</s-paragraph>
                {testResult.balance ? (
                  <s-paragraph>Provider balance: {testResult.balance}</s-paragraph>
                ) : null}
                {testResult.ok ? (
                  <s-paragraph>
                    This checked your credentials. It did not send an SMS — use
                    Send test SMS on the Settings page for that.
                  </s-paragraph>
                ) : null}
              </s-banner>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      <s-section slot="aside" heading="Which should I choose?">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-300">
            <s-text type="strong">Our gateway</s-text>
            <s-text color="subdued">
              Nothing to set up. Good if you send occasionally, or you do not
              already have an SMS provider.
            </s-text>
          </s-stack>

          <s-divider />

          <s-stack direction="block" gap="small-300">
            <s-text type="strong">Your own gateway</s-text>
            <s-text color="subdued">
              Usually cheaper per SMS at high volume, and you keep your existing
              sender ID and provider relationship. You pay us a monthly
              subscription instead of buying credits.
            </s-text>
          </s-stack>

          <s-divider />

          <s-text color="subdued">
            Switching gateways does not move credits between them — a balance at
            one provider cannot be spent at another.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
