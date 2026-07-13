import { useCallback, useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { CreditCounter } from "../components/CreditCounter";
import { SettingsNav } from "../components/SettingsNav";
import { fixAccidentalUnicode, renderTemplate } from "../lib/sms-credits";
import { AUTOMATIONS, SAMPLE_VALUES, settings } from "../mock/settings";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Phase 1: mock data. Phase 3 loads real ShopSettings + MessageTemplates.
  return { settings, automations: AUTOMATIONS };
};

const HOURS = Array.from({ length: 24 }, (_, hour) => {
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return { value: String(hour), label: `${display}:00 ${suffix}` };
});

function AutomationCard({ automation, config, onToggle, onTemplateChange, onTest }) {
  const preview = renderTemplate(config.template, SAMPLE_VALUES);

  const insertVariable = (name) => {
    const token = `{{${name}}}`;
    const needsSpace = config.template.length > 0 && !config.template.endsWith(" ");
    onTemplateChange(automation.key, `${config.template}${needsSpace ? " " : ""}${token}`);
  };

  return (
    <s-section heading={automation.name}>
      <s-stack direction="block" gap="base">
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-text color="subdued">{automation.description}</s-text>
          <s-switch
            label={config.enabled ? "Enabled" : "Disabled"}
            checked={config.enabled}
            onChange={() => onToggle(automation.key)}
          />
        </s-stack>

        {config.enabled ? (
          <s-stack direction="block" gap="base">
            <s-text-area
              label="Message template"
              rows={3}
              value={config.template}
              onInput={(event) =>
                onTemplateChange(automation.key, event.target.value)
              }
            />

            <s-stack direction="block" gap="small-300">
              <s-text color="subdued">Insert a variable</s-text>
              <s-stack direction="inline" gap="small-300">
                {automation.variables.map((name) => (
                  <s-clickable-chip key={name} onClick={() => insertVariable(name)}>
                    {`{{${name}}}`}
                  </s-clickable-chip>
                ))}
              </s-stack>
            </s-stack>

            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="small-300">
                <s-text color="subdued">Preview</s-text>
                <s-paragraph>{preview}</s-paragraph>
              </s-stack>
            </s-box>

            {/* The counter measures the rendered preview, but the fix must be
                written back to the template — so repair the template, not the
                preview, which has nowhere to be saved. */}
            <CreditCounter
              text={preview}
              onFix={() =>
                onTemplateChange(
                  automation.key,
                  fixAccidentalUnicode(config.template).text,
                )
              }
            />

            <s-stack direction="inline" gap="small">
              <s-button
                commandFor="test-sms-modal"
                command="--show"
                onClick={() => onTest(automation.key)}
              >
                Send test SMS
              </s-button>
            </s-stack>
          </s-stack>
        ) : null}
      </s-stack>
    </s-section>
  );
}

export default function Settings() {
  const { automations } = useLoaderData();
  const [form, setForm] = useState(settings);
  const [testKey, setTestKey] = useState(null);

  const updateGlobal = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const toggleAutomation = useCallback((key) => {
    setForm((prev) => ({
      ...prev,
      automations: {
        ...prev.automations,
        [key]: { ...prev.automations[key], enabled: !prev.automations[key].enabled },
      },
    }));
  }, []);

  const updateTemplate = useCallback((key, template) => {
    setForm((prev) => ({
      ...prev,
      automations: {
        ...prev.automations,
        [key]: { ...prev.automations[key], template },
      },
    }));
  }, []);

  const testAutomation = automations.find((a) => a.key === testKey);
  const testMessage = testAutomation
    ? renderTemplate(form.automations[testKey].template, SAMPLE_VALUES)
    : "";

  return (
    <s-page heading="Settings">
      <s-button slot="primary-action" variant="primary">
        Save
      </s-button>

      <s-section>
        <SettingsNav current="/app/settings" />
      </s-section>

      <s-banner tone="info" heading="Preview mode">
        <s-paragraph>
          These settings are not saved yet — the backend is wired up in Phase 3.
          Everything on this page is interactive so you can review the layout and
          the credit counter.
        </s-paragraph>
      </s-banner>

      <s-section heading="Global settings">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Sender ID"
            value={form.senderId}
            details="The masking or number your SMS is sent from, as approved by your gateway."
            onInput={(event) => updateGlobal("senderId", event.target.value)}
          />

          <s-select
            label="Default country code"
            value={form.countryCode}
            details="Applied to local numbers like 01712345678 before sending."
            onChange={(event) => updateGlobal("countryCode", event.target.value)}
          >
            <s-option value="+880">+880 (Bangladesh)</s-option>
          </s-select>

          <s-divider />

          <s-switch
            label="Quiet hours"
            details="Hold non-urgent messages overnight and send them when quiet hours end. OTP messages are always sent immediately."
            checked={form.quietHoursEnabled}
            onChange={() =>
              updateGlobal("quietHoursEnabled", !form.quietHoursEnabled)
            }
          />

          {form.quietHoursEnabled ? (
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
              <s-select
                label="Quiet hours start"
                value={form.quietHoursStart}
                onChange={(event) =>
                  updateGlobal("quietHoursStart", event.target.value)
                }
              >
                {HOURS.map((hour) => (
                  <s-option key={hour.value} value={hour.value}>
                    {hour.label}
                  </s-option>
                ))}
              </s-select>

              <s-select
                label="Quiet hours end"
                value={form.quietHoursEnd}
                onChange={(event) =>
                  updateGlobal("quietHoursEnd", event.target.value)
                }
              >
                {HOURS.map((hour) => (
                  <s-option key={hour.value} value={hour.value}>
                    {hour.label}
                  </s-option>
                ))}
              </s-select>
            </s-grid>
          ) : null}
        </s-stack>
      </s-section>

      {automations.map((automation) => (
        <AutomationCard
          key={automation.key}
          automation={automation}
          config={form.automations[automation.key]}
          onToggle={toggleAutomation}
          onTemplateChange={updateTemplate}
          onTest={setTestKey}
        />
      ))}

      <s-modal id="test-sms-modal" heading="Send test SMS">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            {testAutomation
              ? `Sends the ${testAutomation.name} template with sample values.`
              : ""}
          </s-text>

          <s-box padding="base" background="subdued" borderRadius="base">
            <s-paragraph>{testMessage}</s-paragraph>
          </s-box>

          <CreditCounter text={testMessage} />

          <s-text-field
            label="Send to phone number"
            placeholder="01712345678"
            details="This spends real credits from your balance."
          />
        </s-stack>

        <s-button slot="primary-action" variant="primary">
          Send test
        </s-button>
      </s-modal>
    </s-page>
  );
}
