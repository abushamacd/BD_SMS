import dns from "node:dns/promises";
import net from "node:net";
import { fail, networkFailure, ok, request } from "./contract.js";

// Generic HTTP gateway.
//
// The merchant supplies the URL template, so this adapter sends a request to an
// address WE DO NOT CONTROL. That makes it a server-side request forgery (SSRF)
// vector: a merchant could point it at http://localhost/admin, at another
// service on our private network, or at a cloud metadata endpoint
// (169.254.169.254) to steal our infrastructure credentials — and our server
// would dutifully fetch it and hand back the response.
//
// So every generic URL is resolved and checked before we call it. This is the
// one adapter where the security boundary matters more than the feature.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);

    return (
      a === 0 || // this network
      a === 10 || // private
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a >= 224 // multicast and reserved
    );
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" || // loopback
      lower.startsWith("fc") || // unique local
      lower.startsWith("fd") ||
      lower.startsWith("fe80") || // link-local
      lower.startsWith("::ffff:") // IPv4-mapped — re-check the embedded address
    );
  }

  return true; // unparseable: refuse
}

/**
 * Reject anything that is not a public HTTPS endpoint.
 * Throws with a merchant-readable reason.
 */
export async function assertSafeGatewayUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("The gateway URL is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error(
      "The gateway URL must use https. Customer phone numbers cannot be sent over an unencrypted connection.",
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error("That gateway URL is not allowed.");
  }

  // A literal private IP is refused outright; a hostname is resolved first,
  // because "my-gateway.example.com" is free to resolve to 127.0.0.1.
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true }).catch(() => {
        throw new Error(`Could not resolve ${hostname}.`);
      });

  for (const { address } of addresses) {
    const ip = address.toLowerCase().startsWith("::ffff:")
      ? address.slice(7)
      : address;

    if (isPrivateIp(ip)) {
      throw new Error("That gateway URL is not allowed.");
    }
  }

  return url;
}

/**
 * Substitute the merchant's placeholders. Values are URL-encoded for a GET
 * (they land in a query string) and raw for a POST body.
 */
function fillTemplate(template, values, { encode }) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
    const value = String(values[key] ?? "");
    return encode ? encodeURIComponent(value) : value;
  });
}

export function createGenericAdapter({ apiKey, senderId, urlTemplate, httpMethod = "GET" }) {
  const method = String(httpMethod).toUpperCase() === "POST" ? "POST" : "GET";

  return {
    provider: "GENERIC",

    async send({ phone, message, senderId: overrideSenderId }) {
      const values = {
        api_key: apiKey,
        sender_id: overrideSenderId || senderId || "",
        phone,
        message,
      };

      try {
        // For GET the whole template is the URL. For POST we split it: the part
        // before "?" is the endpoint, the rest becomes the body.
        const filled = fillTemplate(urlTemplate, values, { encode: true });
        const [endpoint, query = ""] = filled.split("?");

        const target = method === "GET" ? filled : endpoint;

        await assertSafeGatewayUrl(target);

        const { response, text, json } = await request(target, {
          method,
          ...(method === "POST"
            ? {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: query,
              }
            : {}),
        });

        // We cannot know a stranger's response codes, so HTTP status is the only
        // signal we can rely on. 5xx is transient; 4xx is the merchant's
        // misconfiguration and retrying it will never help.
        if (response.ok) {
          return ok(json?.message_id ?? json?.id ?? null, json ?? text);
        }

        return fail(
          String(response.status),
          `Gateway responded ${response.status}: ${text.slice(0, 160)}`,
          { retryable: response.status >= 500, raw: json ?? text },
        );
      } catch (error) {
        // A blocked URL is a configuration error, not a transient one.
        if (error.message?.includes("not allowed") || error.message?.includes("https")) {
          return fail("BLOCKED_URL", error.message, { retryable: false });
        }

        return networkFailure(error);
      }
    },

    async testConnection() {
      try {
        await assertSafeGatewayUrl(
          fillTemplate(urlTemplate, {
            api_key: apiKey,
            sender_id: senderId ?? "",
            phone: "",
            message: "",
          }, { encode: true }).split("?")[0],
        );

        return {
          ok: true,
          message:
            "The gateway URL is valid and reachable. Send a test SMS to confirm the provider accepts your credentials.",
          balance: null,
        };
      } catch (error) {
        return { ok: false, message: error.message, balance: null };
      }
    },
  };
}
