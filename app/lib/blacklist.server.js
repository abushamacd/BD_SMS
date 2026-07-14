import db from "../db.server.js";
import { PAGE_SIZE } from "./blacklist.js";
import { parsePhoneList } from "./phone.js";

// The blacklist. Every send checks it (see sms/send.server.js) — this module is
// only about maintaining it.

/**
 * Filtering happens in MySQL, not the browser. A shop that has been running
 * campaigns for a year can have thousands of opt-outs, and shipping them all to
 * the page to filter five of them out is not viable.
 */
export async function queryBlacklist(shop, params, { page = 1 } = {}) {
  const search = (params.get("q") ?? "").trim();
  const source = params.get("source") ?? "";

  const where = {
    shop,
    ...(source ? { source } : {}),
    ...(search
      ? {
          OR: [
            { phone: { contains: search } },
            { name: { contains: search } },
            { note: { contains: search } },
          ],
        }
      : {}),
  };

  const [total, rows, stopCount, allCount] = await Promise.all([
    db.blacklist.count({ where }),
    db.blacklist.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.blacklist.count({ where: { shop, source: "STOP" } }),
    db.blacklist.count({ where: { shop } }),
  ]);

  return {
    rows,
    total,
    stopCount,
    allCount,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/**
 * Block one or more numbers.
 *
 * Numbers are normalised first, so a merchant blocking "01712345678" also blocks
 * the same person written as "+8801712345678" — the send path looks them up by
 * the normalised form, and an un-normalised row would simply never match.
 */
export async function addToBlacklist(shop, { input, note, source = "MANUAL", name = null }) {
  const parsed = parsePhoneList(input);

  if (parsed.valid.length === 0) {
    return { added: 0, skipped: 0, invalid: parsed.invalid };
  }

  // createMany + skipDuplicates: re-blocking an already-blocked number is not an
  // error, and must not overwrite the reason it was blocked in the first place —
  // a STOP reply is a legal record and a merchant re-pasting the number should
  // not turn it into "Added manually".
  const result = await db.blacklist.createMany({
    data: parsed.valid.map((entry) => ({
      shop,
      phone: entry.e164,
      name,
      source,
      note: note?.trim() || null,
    })),
    skipDuplicates: true,
  });

  return {
    added: result.count,
    skipped: parsed.valid.length - result.count,
    invalid: parsed.invalid,
  };
}

/** Unblock. Scoped by shop so an id from another shop cannot be deleted. */
export async function removeFromBlacklist(shop, id) {
  const result = await db.blacklist.deleteMany({ where: { shop, id } });

  return { removed: result.count > 0 };
}
