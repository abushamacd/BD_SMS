import { applyDlr } from "../lib/dlr/apply.server";

// Public delivery-report endpoint: /dlr/:provider/:token
//
// A gateway calls this — not a browser, not Shopify — so there is no session to
// authenticate. The :token in the URL is what ties the report to a shop and keeps
// a stranger from posting reports for someone else's messages. See
// app/lib/dlr/apply.server.js for why this is safe even if the token leaks.
//
// It ALWAYS returns 200. A gateway that gets any other status retries the report,
// often for days; our bugs are ours to find in the logs, not something to have a
// carrier hammer us over.

/** Merge everything the gateway might have sent: query string + body. */
async function collectFields(request) {
  const url = new URL(request.url);
  const fields = Object.fromEntries(url.searchParams.entries());

  if (request.method !== "GET") {
    const type = request.headers.get("content-type") ?? "";

    try {
      if (type.includes("application/json")) {
        Object.assign(fields, await request.json());
      } else {
        // form-urlencoded or multipart — both parse out of formData.
        const form = await request.formData();
        for (const [key, value] of form.entries()) fields[key] = value;
      }
    } catch {
      // A body we cannot parse still leaves the query-string fields, which for
      // many GET-style gateways is everything.
    }
  }

  return fields;
}

async function handle(request, params) {
  try {
    const fields = await collectFields(request);
    const result = await applyDlr(params.token, params.provider, fields);

    console.log(
      `[dlr] ${params.provider}: ${result.reason ?? (result.ok ? "ok" : "ignored")}` +
        (result.messageId ? ` (${result.messageId})` : ""),
    );
  } catch (error) {
    console.error(`[dlr] ${params.provider} failed:`, error);
  }

  // Some gateways read the body to confirm receipt; a bare "OK" satisfies all of
  // them and reveals nothing.
  return new Response("OK", { status: 200 });
}

// GET and POST: BulkSMSBD and many BD gateways report over GET query strings,
// others POST a body.
export const loader = ({ request, params }) => handle(request, params);
export const action = ({ request, params }) => handle(request, params);
