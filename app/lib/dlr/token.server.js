import { randomBytes } from "node:crypto";
import db from "../../db.server.js";

// The DLR callback URL carries a per-shop secret. Because the endpoint is public
// and unauthenticated, this token is the whole of its security: it maps the
// callback to a shop, and only someone who knows it can post reports for that
// shop's messages.
//
// It is safe by construction even if leaked, because a DLR can only change how a
// message is displayed — never credits, never balance — but we still treat it as
// a secret and let the merchant rotate it.

function newToken() {
  return randomBytes(24).toString("base64url");
}

/** This shop's token, generated on first use. */
export async function getDlrToken(shop) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (settings?.dlrToken) return settings.dlrToken;

  const token = newToken();

  await db.shopSettings.update({
    where: { shop },
    data: { dlrToken: token },
  });

  return token;
}

/** Rotate it — the old URL stops working the moment this returns. */
export async function rotateDlrToken(shop) {
  const token = newToken();
  await db.shopSettings.update({ where: { shop }, data: { dlrToken: token } });
  return token;
}

/** Resolve a token back to its shop. Null for an unknown token — the caller 200s anyway. */
export async function shopForDlrToken(token) {
  if (!token) return null;

  const settings = await db.shopSettings.findUnique({
    where: { dlrToken: token },
    select: { shop: true },
  });

  return settings?.shop ?? null;
}

/** The callback URL to paste into the provider's dashboard. */
export function dlrCallbackUrl(appUrl, provider, token) {
  const base = (appUrl ?? "").replace(/\/$/, "");
  return `${base}/dlr/${provider.toLowerCase()}/${token}`;
}
