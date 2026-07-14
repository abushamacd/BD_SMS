import db from "../db.server.js";
import { PAGE_SIZE } from "./logs.js";

// Log queries. Shared by the log page and the CSV export, so the rows you see
// are exactly the rows you export.
//
// Display constants live in ./logs.js, not here — a component importing them
// from a *.server module would drag Prisma into the client bundle.

/** Turn URL search params into a Prisma where clause. */
export function buildWhere(shop, params) {
  const search = (params.get("q") ?? "").trim();
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const where = { shop };

  if (type) where.type = type;
  if (status) where.status = status;

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    // Inclusive of the whole "to" day — a merchant picking today expects today's
    // messages, not everything up to midnight this morning.
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999`);
  }

  if (search) {
    where.OR = [
      { phone: { contains: search } },
      { customerName: { contains: search } },
    ];
  }

  return where;
}

export async function queryLogs(shop, params, { page = 1, take = PAGE_SIZE } = {}) {
  const where = buildWhere(shop, params);

  const [rows, total, creditsAgg, failed] = await Promise.all([
    db.smsLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
    }),
    db.smsLog.count({ where }),
    // Only messages that actually went out cost anything. A SKIPPED row still
    // carries the price it *would* have cost (that is how the UI can show what
    // was avoided), and a FAILED one was refunded — counting either here would
    // tell the merchant they spent more than they did.
    db.smsLog.aggregate({
      where: { ...where, status: { in: ["SENT", "DELIVERED"] } },
      _sum: { credits: true },
    }),
    db.smsLog.count({ where: { ...where, status: "FAILED" } }),
  ]);

  return {
    rows,
    total,
    // Credits across the whole filtered set, not just this page — "how much did I
    // spend on campaigns last week" is the question this page exists to answer.
    credits: creditsAgg._sum.credits ?? 0,
    failed,
    page,
    pages: Math.max(1, Math.ceil(total / take)),
  };
}
