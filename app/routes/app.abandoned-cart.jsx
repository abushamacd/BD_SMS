import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { CreditCounter } from "../components/CreditCounter";
import db from "../db.server";
import {
  DELAY_OPTIONS,
  FOLLOW_UPS,
  STATUS_LABEL,
  STATUS_TONE,
  delayLabel,
} from "../lib/abandoned";
import { SAMPLE_VALUES } from "../lib/automations";
import {
  abandonedStats,
  listCheckouts,
  sendManualFollowUp,
} from "../lib/checkouts/abandoned.server";
import { validateAbandonedSettings } from "../lib/checkouts/validate.server";
import { ensureTemplates, getSettings } from "../lib/settings.server";
import { fixAccidentalUnicode, renderTemplate } from "../lib/sms-credits";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  await ensureTemplates(shop);

  const [settings, templates, checkouts, stats] = await Promise.all([
    getSettings(shop),
    db.messageTemplate.findMany({
      where: { shop, key: { in: FOLLOW_UPS.map((followUp) => followUp.key) } },
    }),
    listCheckouts(shop),
    abandonedStats(shop),
  ]);

  const byKey = Object.fromEntries(
    templates.map((template) => [
      template.key,
      {
        enabled: template.enabled,
        body: template.body,
        delayHours: template.delayHours ?? 1,
        includeDiscount: template.includeDiscount,
      },
    ]),
  );

  return {
    shopName: settings.shopName ?? shop.replace(/\.myshopify\.com$/, ""),
    settings: {
      enabled: settings.abandonedCartEnabled,
      discountEnabled: settings.discountEnabled,
      discountCode: settings.discountCode ?? "",
    },
    followUps: byKey,
    checkouts,
    stats,
    creditBalance: settings.creditBalance,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const intent = form.get("intent");

  // --- Send one reminder by hand -----------------------------------------
  if (intent === "send") {
    const result = await sendManualFollowUp({
      shop,
      checkoutId: String(form.get("checkoutId")),
    });

    return {
      intent: "send",
      ok: Boolean(result.sent),
      message: result.sent
        ? "Recovery SMS sent."
        : (result.reason ?? "Could not send this reminder."),
    };
  }

  // --- Save ---------------------------------------------------------------
  const check = validateAbandonedSettings(form);

  if (!check.ok) {
    return { intent: "save", ok: false, errors: check.errors, global: check.global };
  }

  await db.shopSettings.update({
    where: { shop },
    data: {
      abandonedCartEnabled: form.get("enabled") === "true",
      discountEnabled: form.get("discountEnabled") === "true",
      discountCode: String(form.get("discountCode") ?? "").trim() || null,
    },
  });

  await Promise.all(
    FOLLOW_UPS.map((followUp) =>
      db.messageTemplate.update({
        where: { shop_key: { shop, key: followUp.key } },
        data: {
          enabled: form.get(`enabled:${followUp.key}`) === "true",
          body: String(form.get(`body:${followUp.key}`) ?? ""),
          delayHours: Number(form.get(`delayHours:${followUp.key}`) ?? 1),
          includeDiscount: form.get(`includeDiscount:${followUp.key}`) === "true",
        },
      }),
    ),
  );

  return { intent: "save", ok: true };
};

const bdt = new Intl.NumberFormat("en-BD", {
  style: "currency",
  currency: "BDT",
  maximumFractionDigits: 0,
});

/** "in 38 minutes", "22 minutes ago". */
function relative(iso) {
  if (!iso) return null;

  const diff = new Date(iso).getTime() - Date.now();
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const future = diff > 0;

  const [value, unit] =
    minutes < 60
      ? [minutes, "minute"]
      : minutes < 60 * 24
        ? [Math.round(minutes / 60), "hour"]
        : [Math.round(minutes / (60 * 24)), "day"];

  const text = `${value} ${unit}${value === 1 ? "" : "s"}`;

  return future ? `in ${text}` : `${text} ago`;
}

function absolute(iso) {
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatTile({ label, value, caption }) {
  return (
    <s-box padding="base" borderRadius="base" border="base" background="subdued">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {caption ? <s-text color="subdued">{caption}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

function FollowUpCard({ followUp, config, shopName, discount, errors, onChange }) {
  const preview = renderTemplate(config.body, {
    ...SAMPLE_VALUES,
    shop_name: shopName,
    discount_code: discount.discountCode || SAMPLE_VALUES.discount_code,
  });

  const update = (patch) => onChange(followUp.key, patch);

  const insertVariable = (name) => {
    const token = `{{${name}}}`;
    const needsSpace = config.body.length > 0 && !config.body.endsWith(" ");
    update({ body: `${config.body}${needsSpace ? " " : ""}${token}` });
  };

  // Offering a discount in the first message trains customers to abandon carts
  // on purpose. Worth saying out loud rather than letting merchants find out.
  const discountOnFirst = followUp.index === 0 && config.includeDiscount;

  return (
    <s-box padding="base" borderRadius="base" border="base">
      <s-stack direction="block" gap="base">
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-stack direction="block" gap="small-500">
            <s-text type="strong">{followUp.name}</s-text>
            <s-text color="subdued">
              {config.enabled ? delayLabel(config.delayHours) : "Not sent"}
            </s-text>
          </s-stack>
          <s-switch
            label={config.enabled ? "On" : "Off"}
            checked={config.enabled}
            onChange={() => update({ enabled: !config.enabled })}
          />
        </s-stack>

        {config.enabled ? (
          <s-stack direction="block" gap="base">
            <s-select
              label="Send"
              value={String(config.delayHours)}
              onChange={(event) =>
                update({ delayHours: Number(event.target.value) })
              }
            >
              {DELAY_OPTIONS.map((option) => (
                <s-option key={option.value} value={String(option.value)}>
                  {option.label}
                </s-option>
              ))}
            </s-select>

            <s-text-area
              label="Message"
              rows={3}
              value={config.body}
              error={errors?.length ? errors[0] : undefined}
              onInput={(event) => update({ body: event.target.value })}
            />

            <s-stack direction="block" gap="small-300">
              <s-text color="subdued">Insert a variable</s-text>
              <s-stack direction="inline" gap="small-300">
                {followUp.variables.map((name) => (
                  <s-clickable-chip key={name} onClick={() => insertVariable(name)}>
                    {`{{${name}}}`}
                  </s-clickable-chip>
                ))}
              </s-stack>
            </s-stack>

            {discount.discountEnabled ? (
              <s-checkbox
                label="Include the discount code in this message"
                checked={config.includeDiscount}
                onChange={() => update({ includeDiscount: !config.includeDiscount })}
              />
            ) : null}

            {discountOnFirst ? (
              <s-banner tone="caution" heading="Discounting the first reminder">
                <s-paragraph>
                  Many customers abandon a cart for reasons that have nothing to do
                  with price, and a discount in the first message gives away margin
                  you did not need to spend. Most stores get a better return by
                  reminding first and discounting only if that fails.
                </s-paragraph>
              </s-banner>
            ) : null}

            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="small-300">
                <s-text color="subdued">Preview</s-text>
                <s-paragraph>{preview}</s-paragraph>
              </s-stack>
            </s-box>

            <CreditCounter
              text={preview}
              onFix={() => update({ body: fixAccidentalUnicode(config.body).text })}
            />
          </s-stack>
        ) : null}
      </s-stack>
    </s-box>
  );
}

export default function AbandonedCart() {
  const data = useLoaderData();
  const saveFetcher = useFetcher();
  const sendFetcher = useFetcher();
  const shopify = useAppBridge();

  const [settings, setSettings] = useState(data.settings);
  const [followUps, setFollowUps] = useState(data.followUps);
  const [pending, setPending] = useState(null);

  const saving = saveFetcher.state !== "idle";
  const saveResult = saveFetcher.data?.intent === "save" ? saveFetcher.data : null;
  const sendResult = sendFetcher.data?.intent === "send" ? sendFetcher.data : null;

  useEffect(() => {
    if (saveResult?.ok) shopify.toast.show("Abandoned cart settings saved");
  }, [saveResult, shopify]);

  useEffect(() => {
    if (sendResult?.ok) shopify.toast.show("Recovery SMS sent");
  }, [sendResult, shopify]);

  const updateFollowUp = (key, patch) => {
    setFollowUps((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const save = () => {
    const form = new FormData();
    form.set("intent", "save");
    form.set("enabled", String(settings.enabled));
    form.set("discountEnabled", String(settings.discountEnabled));
    form.set("discountCode", settings.discountCode);

    for (const followUp of FOLLOW_UPS) {
      const config = followUps[followUp.key];
      form.set(`enabled:${followUp.key}`, String(config.enabled));
      form.set(`body:${followUp.key}`, config.body);
      form.set(`delayHours:${followUp.key}`, String(config.delayHours));
      form.set(`includeDiscount:${followUp.key}`, String(config.includeDiscount));
    }

    saveFetcher.submit(form, { method: "post" });
  };

  const sendNow = () => {
    const form = new FormData();
    form.set("intent", "send");
    form.set("checkoutId", pending.id);
    sendFetcher.submit(form, { method: "post" });
  };

  const activeFollowUps = FOLLOW_UPS.filter(
    (followUp) => followUps[followUp.key].enabled,
  ).length;

  const recoveryRate = data.stats.sent
    ? ((data.stats.recovered / data.stats.sent) * 100).toFixed(1)
    : "0.0";

  // The message this customer would get if the merchant presses Send: the next
  // step in their sequence, not always the first.
  const pendingFollowUp = pending ? FOLLOW_UPS[pending.followUpsSent] : null;
  const pendingMessage =
    pending && pendingFollowUp
      ? renderTemplate(followUps[pendingFollowUp.key].body, {
          ...SAMPLE_VALUES,
          shop_name: data.shopName,
          customer_name: pending.customerName,
          cart_total: bdt.format(pending.cartValue),
          discount_code: settings.discountCode || SAMPLE_VALUES.discount_code,
        })
      : "";

  return (
    <s-page heading="Abandoned Cart">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(saving ? { loading: true } : {})}
      >
        Save
      </s-button>

      {saveResult && !saveResult.ok ? (
        <s-banner tone="critical" heading="These settings could not be saved">
          <s-unordered-list>
            {saveResult.global.map((message) => (
              <s-list-item key={message}>{message}</s-list-item>
            ))}
            {Object.entries(saveResult.errors).flatMap(([key, messages]) =>
              messages.map((message) => (
                <s-list-item key={`${key}-${message}`}>
                  {FOLLOW_UPS.find((followUp) => followUp.key === key)?.name}:{" "}
                  {message}
                </s-list-item>
              )),
            )}
          </s-unordered-list>
        </s-banner>
      ) : null}

      <s-section heading="Recovery performance">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <StatTile label="Reminders sent" value={data.stats.sent.toLocaleString()} />
          <StatTile
            label="Carts recovered"
            value={data.stats.recovered.toLocaleString()}
            caption={`${recoveryRate}% of reminders`}
          />
          <StatTile
            label="Revenue recovered"
            value={bdt.format(data.stats.revenue)}
            caption="Only carts we messaged"
          />
        </s-grid>
      </s-section>

      <s-section heading="Recovery messages">
        <s-stack direction="block" gap="base">
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-text color="subdued">
              {settings.enabled
                ? `${activeFollowUps} of 3 follow-ups active`
                : "Abandoned cart recovery is off"}
            </s-text>
            <s-switch
              label={settings.enabled ? "Enabled" : "Disabled"}
              checked={settings.enabled}
              onChange={() =>
                setSettings((prev) => ({ ...prev, enabled: !prev.enabled }))
              }
            />
          </s-stack>

          {settings.enabled ? (
            <s-stack direction="block" gap="base">
              <s-banner tone="info" heading="Only customers who opted in are messaged">
                <s-paragraph>
                  A cart reminder is a marketing message, so it is only sent to
                  customers who accepted SMS marketing at checkout. Customers who
                  did not opt in are shown below as skipped.
                </s-paragraph>
              </s-banner>

              <s-divider />

              <s-switch
                label="Attach a discount code"
                details="A discount is the single biggest lever on recovery rate — and the most expensive one."
                checked={settings.discountEnabled}
                onChange={() =>
                  setSettings((prev) => ({
                    ...prev,
                    discountEnabled: !prev.discountEnabled,
                  }))
                }
              />

              {settings.discountEnabled ? (
                <s-text-field
                  label="Discount code"
                  value={settings.discountCode}
                  details="Create this code in Shopify first. The app inserts it as {{discount_code}}."
                  onInput={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      discountCode: event.target.value,
                    }))
                  }
                />
              ) : null}

              <s-divider />

              {FOLLOW_UPS.map((followUp) => (
                <FollowUpCard
                  key={followUp.key}
                  followUp={followUp}
                  config={followUps[followUp.key]}
                  shopName={data.shopName}
                  discount={settings}
                  errors={saveResult?.errors?.[followUp.key]}
                  onChange={updateFollowUp}
                />
              ))}
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Abandoned checkouts">
        {data.checkouts.length === 0 ? (
          <s-paragraph>
            No abandoned checkouts yet. One is recorded when a customer reaches
            checkout, enters their details, and leaves without ordering — before
            that Shopify gives us no phone number, so there is nobody to text.
          </s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Cart value</s-table-header>
              <s-table-header>Abandoned</s-table-header>
              <s-table-header>SMS</s-table-header>
              <s-table-header>Recovered</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.checkouts.map((checkout) => (
                <s-table-row key={checkout.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-500">
                      <s-text>{checkout.customerName}</s-text>
                      <s-text color="subdued">{checkout.phone}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{bdt.format(checkout.cartValue)}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-500">
                      <s-text>{relative(checkout.abandonedAt)}</s-text>
                      <s-text color="subdued">{absolute(checkout.abandonedAt)}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-500">
                      <s-badge tone={STATUS_TONE[checkout.status]}>
                        {STATUS_LABEL[checkout.status]}
                      </s-badge>
                      <s-text color="subdued">
                        {checkout.blockedReason && checkout.followUpsSent === 0
                          ? checkout.blockedReason
                          : checkout.nextDueAt
                            ? `${checkout.followUpsSent} sent · next ${relative(checkout.nextDueAt)}`
                            : `${checkout.followUpsSent} sent`}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={checkout.recovered ? "success" : "neutral"}>
                      {checkout.recovered ? "Yes" : "No"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-button
                      commandFor="manual-send-modal"
                      command="--show"
                      onClick={() => setPending(checkout)}
                      {...(checkout.blockedReason ? { disabled: true } : {})}
                    >
                      Send SMS
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-modal id="manual-send-modal" heading="Send recovery SMS">
        <s-stack direction="block" gap="base">
          {pending && pendingFollowUp ? (
            <>
              <s-paragraph>
                Sends {pendingFollowUp.name.toLowerCase()} to{" "}
                <s-text type="strong">{pending.customerName}</s-text> ({pending.phone})
                now, without waiting for {delayLabel(
                  followUps[pendingFollowUp.key].delayHours,
                ).toLowerCase()}.
              </s-paragraph>

              <s-box padding="base" background="subdued" borderRadius="base">
                <s-paragraph>{pendingMessage}</s-paragraph>
              </s-box>

              <CreditCounter text={pendingMessage} recipients={1} />

              <s-text color="subdued">
                The rest of the sequence carries on as normal — the next reminder
                is still timed from when they abandoned the cart.
              </s-text>

              {sendResult && !sendResult.ok ? (
                <s-banner tone="critical" heading="Could not send">
                  <s-paragraph>{sendResult.message}</s-paragraph>
                </s-banner>
              ) : null}
            </>
          ) : null}
        </s-stack>

        <s-button
          slot="primary-action"
          variant="primary"
          onClick={sendNow}
          {...(sendFetcher.state !== "idle" ? { loading: true } : {})}
        >
          Send now
        </s-button>
        <s-button
          slot="secondary-actions"
          command="--hide"
          commandFor="manual-send-modal"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
