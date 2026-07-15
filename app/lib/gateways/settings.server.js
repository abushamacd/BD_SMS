import db from "../../db.server.js";
import { decryptJson, maskSecret } from "../crypto.server.js";
import { dlrCallbackUrl, getDlrToken } from "../dlr/token.server.js";
import { assertSafeGatewayUrl } from "./generic.server.js";
import { buildAdapter, saveGateway } from "./index.server.js";
import {
  REQUIRED_TEMPLATE_VARIABLES,
  getProvider,
  secretKeys,
} from "./providers.js";

// The gateway settings form.
//
// The rule that shapes this whole module: a saved API key is NEVER sent back to
// the browser, not even to prefill the field the merchant typed it into. So the
// form posts an empty secret when the merchant has not retyped it, and "empty"
// has to mean "keep the saved one" rather than "erase it" — otherwise opening
// this page and pressing Save would silently wipe the credentials and every SMS
// after that would fail.

/** The saved credentials, decrypted. Server-side only — never returned to a loader. */
async function savedCredentials(shop, provider) {
  const gateway = await db.gateway.findUnique({ where: { shop } });

  // Credentials belong to the provider they were entered for. Carrying a
  // BulkSMSBD key over to an SSL Wireless account would be nonsense, so a
  // provider change means the merchant must type the new key in.
  if (!gateway?.credentials || gateway.provider !== provider) return {};

  try {
    return decryptJson(gateway.credentials);
  } catch {
    // The key changed, or the row is corrupt. Treat it as absent rather than
    // crashing the settings page — the merchant can re-enter the credentials.
    return {};
  }
}

/** What the page shows. Secrets appear only as a masked hint, never in full. */
export async function loadGatewaySettings(shop) {
  const [settings, gateway] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    db.gateway.findUnique({ where: { shop } }),
  ]);

  const provider = gateway?.provider ?? "BULKSMSBD";
  const credentials = await savedCredentials(shop, provider);
  const secrets = new Set(secretKeys(provider));

  const hints = Object.fromEntries(
    Object.entries(credentials)
      .filter(([key, value]) => secrets.has(key) && value)
      .map(([key, value]) => [key, maskSecret(value)]),
  );

  return {
    mode: settings?.gatewayMode ?? "DEFAULT",
    subscriptionActive: settings?.subscriptionActive ?? false,
    provider,
    senderId: gateway?.senderId ?? "",
    // Non-secret credentials (a username) may be prefilled. Secret ones may not.
    username: credentials.username ?? "",
    urlTemplate: gateway?.urlTemplate ?? "",
    httpMethod: gateway?.httpMethod ?? "GET",
    // e.g. { apiKey: "••••zJ31" } — enough for the merchant to recognise which
    // key is saved, useless to anyone who intercepts it.
    secretHints: hints,
    // The delivery-report callback URL for this shop + provider, to paste into
    // the provider's dashboard. Without it the merchant cannot receive DLRs and
    // every message stays "Sent" forever, whether or not it arrived.
    dlrCallbackUrl: dlrCallbackUrl(
      process.env.SHOPIFY_APP_URL ?? "",
      provider,
      await getDlrToken(shop),
    ),
    lastTest: gateway?.lastTestedAt
      ? {
          at: gateway.lastTestedAt.toISOString(),
          ok: gateway.lastTestOk,
          error: gateway.lastTestError,
        }
      : null,
  };
}

/**
 * Read the form, merging any secret the merchant left blank with the one already
 * saved. Returns the values plus any reason they cannot be used.
 */
export async function readGatewayForm(shop, form) {
  const mode = String(form.get("mode") ?? "DEFAULT");
  const provider = String(form.get("provider") ?? "BULKSMSBD");
  const senderId = String(form.get("senderId") ?? "").trim();
  const urlTemplate = String(form.get("urlTemplate") ?? "").trim();
  const httpMethod = String(form.get("httpMethod") ?? "GET");

  const definition = getProvider(provider);
  const existing = await savedCredentials(shop, provider);

  const credentials = {};

  for (const field of definition.fields) {
    if (field.key === "senderId") continue; // stored on the Gateway row, not encrypted

    const typed = String(form.get(field.key) ?? "").trim();

    // Blank secret + a saved one → the merchant did not retype it. Keep it.
    credentials[field.key] =
      typed || (field.secret ? (existing[field.key] ?? "") : "");
  }

  const errors = [];

  if (mode === "PERSONAL") {
    for (const field of definition.fields) {
      const value = field.key === "senderId" ? senderId : credentials[field.key];

      if (!value) errors.push(`${field.label} is required.`);
    }

    if (definition.urlEditable) {
      for (const variable of REQUIRED_TEMPLATE_VARIABLES) {
        if (!urlTemplate.includes(`{{${variable}}}`)) {
          errors.push(
            `The request URL must include {{${variable}}} — without it the gateway has no way to know what to send.`,
          );
        }
      }

      if (urlTemplate) {
        try {
          // The same check the send path runs, done here so an unsafe URL is
          // refused at the point the merchant can still fix it.
          await assertSafeGatewayUrl(urlTemplate.split("?")[0]);
        } catch (error) {
          errors.push(error.message);
        }
      }
    }
  }

  return {
    mode,
    provider,
    senderId,
    urlTemplate: definition.urlEditable ? urlTemplate : null,
    httpMethod,
    credentials,
    errors,
  };
}

/** Try the credentials against the provider without saving them. */
export async function testGatewayConnection(shop, form) {
  const values = await readGatewayForm(shop, form);

  if (values.errors.length > 0) {
    return { ok: false, message: values.errors[0], balance: null };
  }

  let result;

  try {
    const adapter = buildAdapter({
      provider: values.provider,
      credentials: values.credentials,
      senderId: values.senderId,
      urlTemplate: values.urlTemplate,
      httpMethod: values.httpMethod,
    });

    result = await adapter.testConnection();
  } catch (error) {
    result = { ok: false, message: error.message, balance: null };
  }

  // Recorded so the page can show gateway health on load without calling the
  // provider again. updateMany, not update: there may be no row yet — a merchant
  // is allowed to test credentials before committing them.
  await db.gateway.updateMany({
    where: { shop },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: result.ok,
      lastTestError: result.ok ? null : result.message,
      // The balance at THEIR provider — the one they actually spend. Cached for
      // display; we never bill from it.
      ...(result.balance
        ? { lastBalance: String(result.balance), lastBalanceAt: new Date() }
        : {}),
    },
  });

  return result;
}

export async function saveGatewaySettings(shop, form) {
  const values = await readGatewayForm(shop, form);

  if (values.errors.length > 0) return { ok: false, errors: values.errors };

  // Written even in DEFAULT mode, so a merchant who switches back to their own
  // gateway does not have to re-enter everything.
  if (values.mode === "PERSONAL" || values.credentials.apiKey) {
    await saveGateway(shop, {
      provider: values.provider,
      credentials: values.credentials,
      senderId: values.senderId,
      urlTemplate: values.urlTemplate,
      httpMethod: values.httpMethod,
    });
  }

  await db.shopSettings.update({
    where: { shop },
    data: { gatewayMode: values.mode },
  });

  return { ok: true };
}
