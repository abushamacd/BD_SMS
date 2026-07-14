import { useCallback, useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { CreditCounter } from "../components/CreditCounter";
import { SettingsNav } from "../components/SettingsNav";
import db from "../db.server";
import { AUTOMATIONS, SAMPLE_VALUES } from "../lib/automations";
import { ensureTemplates, getSettings } from "../lib/settings.server";
import { fixAccidentalUnicode, renderTemplate } from "../lib/sms-credits";
import { renderMessage, validateTemplate } from "../lib/templates.server";
import { sendSms } from "../lib/sms/send.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  await ensureTemplates(shop);

  const [settings, templates] = await Promise.all([
    getSettings(shop),
    db.messageTemplate.findMany({ where: { shop } }),
  ]);

  const byKey = Object.fromEntries(
    templates.map((template) => [
      template.key,
      { enabled: template.enabled, body: template.body },
    ]),
  );

  return {
    shopName: settings.shopName ?? shop.replace(/\.myshopify\.com$/, ""),
    settings: {
      senderId: settings.senderId ?? "",
      countryCode: settings.countryCode,
      quietHoursEnabled: settings.quietHoursEnabled,
      quietHoursStart: String(settings.quietHoursStart),
      quietHoursEnd: String(settings.quietHoursEnd),
    },
    templates: byKey,
    creditBalance: settings.creditBalance,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const intent = form.get("intent");

  // --- Send a test SMS ---------------------------------------------------
  if (intent === "test") {
    const key = String(form.get("key"));
    const phone = String(form.get("phone") ?? "");
    const body = String(form.get("body") ?? "");
    const settings = await getSettings(shop);

    const rendered = renderMessage(body, {
      ...SAMPLE_VALUES,
      shop_name: settings.shopName ?? shop.replace(/\.myshopify\.com$/, ""),
    });

    if (rendered.blocked) {
      return { intent: "test", ok: false, message: rendered.reason };
    }

    const result = await sendSms({
      shop,
      phone,
      message: rendered.text,
      type: "TEST",
      // A test is the merchant messaging themselves — no consent question, and
      // it must not be held until 8am while they are sat waiting for it.
      consentOverride: true,
      ignoreQuietHours: true,
    });

    const ok = result.outcome === "SENT";

    return {
      intent: "test",
      ok,
      message: ok
        ? `Test sent to ${phone}. It cost ${result.credits} credit${result.credits === 1 ? "" : "s"}.`
        : (result.reason ?? `Could not send (${result.outcome}).`),
      key,
    };
  }

  // --- Save --------------------------------------------------------------
  const errors = {};

  for (const automation of AUTOMATIONS) {
    const body = String(form.get(`body:${automation.key}`) ?? "");
    const enabled = form.get(`enabled:${automation.key}`) === "true";

    // Only an enabled automation must be valid. A merchant may leave a switched
    // off template half-written.
    if (enabled) {
      const check = validateTemplate(automation.key, body);
      if (!check.ok) errors[automation.key] = check.errors;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { intent: "save", ok: false, errors };
  }

  await db.shopSettings.update({
    where: { shop },
    data: {
      senderId: String(form.get("senderId") ?? "").trim() || null,
      countryCode: String(form.get("countryCode") ?? "+880"),
      quietHoursEnabled: form.get("quietHoursEnabled") === "true",
      quietHoursStart: Number(form.get("quietHoursStart") ?? 22),
      quietHoursEnd: Number(form.get("quietHoursEnd") ?? 8),
    },
  });

  await Promise.all(
    AUTOMATIONS.map((automation) =>
      db.messageTemplate.update({
        where: { shop_key: { shop, key: automation.key } },
        data: {
          enabled: form.get(`enabled:${automation.key}`) === "true",
          body: String(form.get(`body:${automation.key}`) ?? ""),
        },
      }),
    ),
  );

  return { intent: "save", ok: true };
};

const HOURS = Array.from({ length: 24 }, (_, hour) => {
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return { value: String(hour), label: `${display}:00 ${suffix}` };
});

function AutomationCard({ automation, config, shopName, errors, onToggle, onTemplateChange, onTest }) {
  const preview = renderTemplate(config.body, {
    ...SAMPLE_VALUES,
    shop_name: shopName,
  });

  const insertVariable = (name) => {
    const token = `{{${name}}}`;
    const needsSpace = config.body.length > 0 && !config.body.endsWith(" ");
    onTemplateChange(automation.key, `${config.body}${needsSpace ? " " : ""}${token}`);
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
              value={config.body}
              error={errors?.length ? errors[0] : undefined}
              onInput={(event) => onTemplateChange(automation.key, event.target.value)}
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

            <CreditCounter
              text={preview}
              onFix={() =>
                onTemplateChange(automation.key, fixAccidentalUnicode(config.body).text)
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
  const data = useLoaderData();
  const saveFetcher = useFetcher();
  const testFetcher = useFetcher();
  const shopify = useAppBridge();

  const [settings, setSettings] = useState(data.settings);
  const [templates, setTemplates] = useState(data.templates);
  const [testKey, setTestKey] = useState(null);
  const [testPhone, setTestPhone] = useState("");

  const saving = saveFetcher.state !== "idle";
  const saveResult = saveFetcher.data?.intent === "save" ? saveFetcher.data : null;
  const testResult = testFetcher.data?.intent === "test" ? testFetcher.data : null;

  useEffect(() => {
    if (saveResult?.ok) shopify.toast.show("Settings saved");
  }, [saveResult, shopify]);

  const updateGlobal = useCallback((field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  }, []);

  const toggleAutomation = useCallback((key) => {
    setTemplates((prev) => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key].enabled },
    }));
  }, []);

  const updateTemplate = useCallback((key, body) => {
    setTemplates((prev) => ({ ...prev, [key]: { ...prev[key], body } }));
  }, []);

  const save = () => {
    const form = new FormData();
    form.set("intent", "save");
    form.set("senderId", settings.senderId);
    form.set("countryCode", settings.countryCode);
    form.set("quietHoursEnabled", String(settings.quietHoursEnabled));
    form.set("quietHoursStart", settings.quietHoursStart);
    form.set("quietHoursEnd", settings.quietHoursEnd);

    for (const automation of AUTOMATIONS) {
      const config = templates[automation.key];
      form.set(`enabled:${automation.key}`, String(config.enabled));
      form.set(`body:${automation.key}`, config.body);
    }

    saveFetcher.submit(form, { method: "post" });
  };

  const sendTest = () => {
    const form = new FormData();
    form.set("intent", "test");
    form.set("key", testKey);
    form.set("phone", testPhone);
    form.set("body", templates[testKey].body);
    testFetcher.submit(form, { method: "post" });
  };

  const testAutomation = AUTOMATIONS.find((automation) => automation.key === testKey);
  const testMessage = testAutomation
    ? renderTemplate(templates[testKey].body, {
        ...SAMPLE_VALUES,
        shop_name: data.shopName,
      })
    : "";

  return (
    <s-page heading="Settings">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(saving ? { loading: true } : {})}
      >
        Save
      </s-button>

      <s-section>
        <SettingsNav current="/app/settings" />
      </s-section>

      {saveResult && !saveResult.ok ? (
        <s-banner tone="critical" heading="Some templates could not be saved">
          <s-unordered-list>
            {Object.entries(saveResult.errors).flatMap(([key, messages]) =>
              messages.map((message) => (
                <s-list-item key={`${key}-${message}`}>
                  {AUTOMATIONS.find((a) => a.key === key)?.name}: {message}
                </s-list-item>
              )),
            )}
          </s-unordered-list>
        </s-banner>
      ) : null}

      <s-section heading="Global settings">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Sender ID"
            value={settings.senderId}
            details="The masking or number your SMS is sent from, as approved by your gateway."
            onInput={(event) => updateGlobal("senderId", event.target.value)}
          />

          <s-select
            label="Default country code"
            value={settings.countryCode}
            details="Applied to local numbers like 01712345678 before sending."
            onChange={(event) => updateGlobal("countryCode", event.target.value)}
          >
            <s-option value="+880">+880 (Bangladesh)</s-option>
          </s-select>

          <s-divider />

          <s-switch
            label="Quiet hours"
            details="Hold non-urgent messages overnight and send them when quiet hours end. COD verification codes are always sent immediately — a customer waiting at checkout cannot wait until morning."
            checked={settings.quietHoursEnabled}
            onChange={() =>
              updateGlobal("quietHoursEnabled", !settings.quietHoursEnabled)
            }
          />

          {settings.quietHoursEnabled ? (
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
              <s-select
                label="Quiet hours start"
                value={settings.quietHoursStart}
                onChange={(event) => updateGlobal("quietHoursStart", event.target.value)}
              >
                {HOURS.map((hour) => (
                  <s-option key={hour.value} value={hour.value}>
                    {hour.label}
                  </s-option>
                ))}
              </s-select>

              <s-select
                label="Quiet hours end"
                value={settings.quietHoursEnd}
                onChange={(event) => updateGlobal("quietHoursEnd", event.target.value)}
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

      {AUTOMATIONS.map((automation) => (
        <AutomationCard
          key={automation.key}
          automation={automation}
          config={templates[automation.key]}
          shopName={data.shopName}
          errors={saveResult?.errors?.[automation.key]}
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
            details={`This spends real credits. You have ${data.creditBalance.toLocaleString()}.`}
            value={testPhone}
            onInput={(event) => setTestPhone(event.target.value)}
          />

          {testResult ? (
            <s-banner
              tone={testResult.ok ? "success" : "critical"}
              heading={testResult.ok ? "Test sent" : "Could not send"}
            >
              <s-paragraph>{testResult.message}</s-paragraph>
            </s-banner>
          ) : null}
        </s-stack>

        <s-button
          slot="primary-action"
          variant="primary"
          onClick={sendTest}
          {...(testFetcher.state !== "idle" ? { loading: true } : {})}
          {...(testPhone.trim() ? {} : { disabled: true })}
        >
          Send test
        </s-button>
        <s-button slot="secondary-actions" command="--hide" commandFor="test-sms-modal">
          Close
        </s-button>
      </s-modal>
    </s-page>
  );
}
