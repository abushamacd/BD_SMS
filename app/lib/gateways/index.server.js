import db from "../../db.server.js";
import { decryptJson, encryptJson } from "../crypto.server.js";
import { ok } from "./contract.js";
import { createBulkSmsBdAdapter } from "./bulksmsbd.server.js";
import { createGenericAdapter } from "./generic.server.js";
import { createMiMsmsAdapter } from "./mimsms.server.js";
import { createSslWirelessAdapter } from "./sslwireless.server.js";

const FACTORIES = {
  BULKSMSBD: createBulkSmsBdAdapter,
  MIMSMS: createMiMsmsAdapter,
  SSLWIRELESS: createSslWirelessAdapter,
  GENERIC: createGenericAdapter,
};

/**
 * Never sends. Every call succeeds and is logged, so development and tests can
 * exercise the whole pipeline — credit debits, log rows, queue transitions —
 * without spending real credits or texting real people.
 */
function createDryRunAdapter(provider) {
  return {
    provider,
    dryRun: true,

    async send({ phone, message }) {
      console.log(
        `[SMS_DRY_RUN] would send via ${provider} to ${phone}: ${message.slice(0, 60)}${message.length > 60 ? "…" : ""}`,
      );

      return ok(`dryrun_${Math.random().toString(36).slice(2, 10)}`, { dryRun: true });
    },

    async testConnection() {
      return {
        ok: true,
        message: `Dry run is on (SMS_DRY_RUN=true), so nothing was sent to ${provider}.`,
        balance: null,
      };
    },
  };
}

const isDryRun = () => process.env.SMS_DRY_RUN === "true";

/** The app's own gateway, used by merchants who buy credits from us. */
function defaultAdapter() {
  const provider = (process.env.DEFAULT_SMS_PROVIDER ?? "bulksmsbd").toUpperCase();

  if (isDryRun()) return createDryRunAdapter(provider);

  const factory = FACTORIES[provider];

  if (!factory) {
    throw new Error(`DEFAULT_SMS_PROVIDER is not a known provider: ${provider}`);
  }

  return factory({
    apiKey: process.env.DEFAULT_SMS_API_KEY,
    senderId: process.env.DEFAULT_SMS_SENDER_ID,
    username: process.env.DEFAULT_SMS_USERNAME,
    urlTemplate: process.env.DEFAULT_SMS_API_URL,
  });
}

/**
 * Resolve the adapter a shop should send through.
 *
 * DEFAULT mode  → our gateway, our credentials, merchant spends credits with us.
 * PERSONAL mode → the merchant's own gateway and credentials, decrypted here and
 *                 nowhere else.
 */
export async function getAdapterForShop(shop) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (!settings || settings.gatewayMode === "DEFAULT") {
    return defaultAdapter();
  }

  const gateway = await db.gateway.findUnique({ where: { shop } });

  if (!gateway?.credentials) {
    throw new Error(
      "This shop is set to use its own SMS gateway, but no gateway credentials are saved.",
    );
  }

  if (isDryRun()) return createDryRunAdapter(gateway.provider);

  const credentials = decryptJson(gateway.credentials);
  const factory = FACTORIES[gateway.provider];

  if (!factory) {
    throw new Error(`Unknown gateway provider: ${gateway.provider}`);
  }

  return factory({
    ...credentials,
    senderId: gateway.senderId,
    urlTemplate: gateway.urlTemplate,
    httpMethod: gateway.httpMethod,
  });
}

/**
 * Build an adapter from unsaved form values, so "Test connection" can be run
 * before the merchant commits credentials they might have typed wrong.
 */
export function buildAdapter({ provider, credentials, senderId, urlTemplate, httpMethod }) {
  if (isDryRun()) return createDryRunAdapter(provider);

  const factory = FACTORIES[provider];

  if (!factory) {
    throw new Error(`Unknown gateway provider: ${provider}`);
  }

  return factory({ ...credentials, senderId, urlTemplate, httpMethod });
}

/**
 * Save a merchant's gateway. Credentials are encrypted here and are the only
 * thing in this app that is written encrypted — they must never reach a plain
 * column, a log line, or a loader response.
 */
export async function saveGateway(shop, { provider, credentials, senderId, urlTemplate, httpMethod }) {
  const encrypted = credentials ? encryptJson(credentials) : null;

  const data = {
    provider,
    senderId,
    urlTemplate,
    httpMethod,
    ...(encrypted ? { credentials: encrypted } : {}),
  };

  return db.gateway.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}
