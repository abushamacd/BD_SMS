import { authenticate } from "../shopify.server";
import db from "../db.server";
import { TYPE_LABEL } from "../lib/logs";
import { buildWhere } from "../lib/logs.server";
import { formatBdPhone } from "../lib/phone";

// Resource route: returns every row matching the current filters, so the CSV is
// the whole filtered set and not just the page on screen.
//
// Capped, because a merchant with 200,000 log rows would otherwise ask the
// server to serialise all of them into one response and fall over. The cap is
// reported back so the UI can say so rather than silently truncating.
const EXPORT_LIMIT = 10_000;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const where = buildWhere(session.shop, url.searchParams);

  const rows = await db.smsLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: EXPORT_LIMIT,
  });

  return {
    truncated: rows.length === EXPORT_LIMIT,
    rows: rows.map((row) => ({
      sentAt: row.createdAt.toISOString().replace("T", " ").slice(0, 19),
      name: row.customerName ?? "Unknown",
      phone: formatBdPhone(row.phone),
      typeLabel: TYPE_LABEL[row.type] ?? row.type,
      message: row.body,
      credits: row.credits,
      status: row.status,
      gateway: row.provider,
      error: row.errorMessage ?? "",
    })),
  };
};
