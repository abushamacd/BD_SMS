import { useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { SettingsNav } from "../components/SettingsNav";
import {
  GATEWAY_MODES,
  HTTP_METHODS,
  PROVIDERS,
  SAMPLE_TEST_RESULT,
  gateway,
} from "../mock/gateways";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Phase 1: mock data. Phase 2 loads the real Gateway record (credentials
  // decrypted only at send time, never returned to the browser).
  return { gateway, providers: PROVIDERS };
};

export default function GatewaySettings() {
  const data = useLoaderData();
  const [form, setForm] = useState(data.gateway);
  const [testResult, setTestResult] = useState(null);

  const isPersonal = form.mode === "personal";
  const provider = data.providers.find((entry) => entry.value === form.provider);

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  // Phase 2 makes this a real request to the provider. Showing a fake success
  // would be worse than showing nothing, so it says what it is.
  const runTest = () => setTestResult(SAMPLE_TEST_RESULT);

  const missingFields = isPersonal
    ? provider.fields.filter((field) => !form[field.key]?.trim()).length
    : 0;

  const canTest = isPersonal && missingFields === 0;

  return (
    <s-page heading="SMS gateway">
      <s-button slot="primary-action" variant="primary">
        Save
      </s-button>

      <s-section>
        <SettingsNav current="/app/settings/gateway" />
      </s-section>

      <s-banner tone="info" heading="Preview mode">
        <s-paragraph>
          Gateway settings are not saved and Test connection does not call the
          provider yet — both arrive in Phase 2.
        </s-paragraph>
      </s-banner>

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
                credits are then bought from your provider, not from us.
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
                update({ provider: event.target.value, url: "" })
              }
            >
              {data.providers.map((entry) => (
                <s-option key={entry.value} value={entry.value}>
                  {entry.label}
                </s-option>
              ))}
            </s-select>

            {provider.urlEditable ? (
              <s-stack direction="block" gap="base">
                <s-select
                  label="Request method"
                  value={form.method}
                  onChange={(event) => update({ method: event.target.value })}
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
                  details="Use {{api_key}}, {{sender_id}}, {{phone}} and {{message}} — we substitute them for each message."
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

              return (
                <Field
                  key={field.key}
                  label={field.label}
                  value={form[field.key] ?? ""}
                  {...(field.details ? { details: field.details } : {})}
                  onInput={(event) => update({ [field.key]: event.target.value })}
                />
              );
            })}

            <s-banner tone="info" heading="Your credentials are encrypted">
              <s-paragraph>
                API keys are encrypted before they are stored and are only
                decrypted at the moment a message is sent. They are never shown
                back to you or to us in plain text.
              </s-paragraph>
            </s-banner>

            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button
                onClick={runTest}
                {...(canTest ? {} : { disabled: true })}
              >
                Test connection
              </s-button>
              {!canTest ? (
                <s-text color="subdued">
                  Fill in {missingFields} more{" "}
                  {missingFields === 1 ? "field" : "fields"} to test.
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
