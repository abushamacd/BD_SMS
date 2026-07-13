import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// AES-256-GCM for merchant gateway credentials.
//
// Why GCM and not CBC: GCM is authenticated. A tampered ciphertext fails to
// decrypt rather than silently producing garbage that we then send to a
// provider. The auth tag is what buys that.
//
// Stored format: iv:authTag:ciphertext, all base64. The IV is random per
// encryption — reusing an IV with the same key destroys GCM's security, so it
// is never derived from anything.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, the size GCM is specified for

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;

  if (!hex) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32",
    );
  }

  const key = Buffer.from(hex, "hex");

  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${key.length} bytes.`,
    );
  }

  return key;
}

/** @param {object} value Credentials object, e.g. { apiKey, username } */
export function encryptJson(value) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const plaintext = JSON.stringify(value);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Returns null for empty input so callers can treat "not configured" as a value. */
export function decryptJson(payload) {
  if (!payload) return null;

  const [ivB64, tagB64, dataB64] = payload.split(":");

  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext);
}

/**
 * Mask a secret for display. The merchant needs to recognise which key is
 * stored without us ever sending it back to the browser.
 */
export function maskSecret(secret) {
  if (!secret) return "";
  const text = String(secret);
  if (text.length <= 4) return "•".repeat(text.length);
  return `${"•".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

/** COD OTP codes are stored hashed — see the CodOtp model. */
export function hashOtp(code, shop) {
  return createHash("sha256").update(`${shop}:${code}`).digest("hex");
}
