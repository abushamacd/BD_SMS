import db from "../../db.server.js";

// A DB-backed job queue. No Redis, no broker — the same MySQL that holds the
// credits holds the queue, so a job and the credit debit it causes can never
// disagree about whether they happened.
//
// The two hard parts of any queue are both handled here:
//
//   Claiming   — two workers must never run the same job. Claims are a
//                conditional UPDATE (`WHERE status = PENDING`); MySQL serialises
//                the row, so exactly one worker's update reports count = 1.
//   Crashes    — a worker that dies mid-job leaves the row RUNNING forever. Any
//                job whose lock is older than LOCK_TIMEOUT is reclaimed.

const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // a job may run for 5 minutes before it is presumed dead

// Retry backoff: 1min, 4min, 9min… (attempts² × 60s) with jitter, capped.
// Jitter matters — without it, 500 messages failed by one gateway outage all
// retry at the same instant and knock the gateway over again.
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;

export function backoffFor(attempts) {
  const base = Math.min(BACKOFF_BASE_MS * attempts ** 2, BACKOFF_MAX_MS);
  const jitter = base * 0.25 * Math.random();
  return new Date(Date.now() + base + jitter);
}

/**
 * Add a job. `dedupeKey` is globally unique, so it must include the shop —
 * "shop.myshopify.com:ABANDONED:token123". Enqueuing the same key twice is a
 * no-op, which is what stops a redelivered webhook from scheduling two
 * follow-ups for one checkout.
 */
export async function enqueue({
  shop,
  type,
  payload = {},
  runAt = new Date(),
  priority = 0,
  maxAttempts = 3,
  dedupeKey = null,
}) {
  try {
    return await db.job.create({
      data: { shop, type, payload, runAt, priority, maxAttempts, dedupeKey },
    });
  } catch (error) {
    if (error.code === "P2002" && dedupeKey) {
      return db.job.findUnique({ where: { dedupeKey } });
    }
    throw error;
  }
}

/**
 * Claim up to `limit` jobs for this worker.
 *
 * Candidates are read, then each is claimed with a conditional update. The read
 * is not the claim — between the two, another worker may take the job, and its
 * update reports count = 0, so it simply moves on.
 */
export async function claim(workerId, limit = 5) {
  const candidates = await db.job.findMany({
    where: { status: "PENDING", runAt: { lte: new Date() } },
    // Priority first: an OTP a customer is waiting for must not queue behind
    // 10,000 campaign messages.
    orderBy: [{ priority: "desc" }, { runAt: "asc" }],
    take: limit,
    select: { id: true },
  });

  const claimed = [];

  for (const { id } of candidates) {
    const result = await db.job.updateMany({
      where: { id, status: "PENDING" }, // ← the lock
      data: {
        status: "RUNNING",
        lockedBy: workerId,
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (result.count === 1) {
      claimed.push(await db.job.findUnique({ where: { id } }));
    }
  }

  return claimed;
}

export async function complete(jobId) {
  return db.job.update({
    where: { id: jobId },
    data: {
      status: "DONE",
      completedAt: new Date(),
      lockedBy: null,
      lockedAt: null,
    },
  });
}

/**
 * A job failed. Retry with backoff if attempts remain, otherwise bury it.
 * `retryable: false` buries it immediately — retrying an invalid number or a
 * bad sender ID burns a credit every time and can never succeed.
 */
export async function fail(job, error, { retryable = true } = {}) {
  const message = String(error?.message ?? error).slice(0, 2000);
  const exhausted = job.attempts >= job.maxAttempts;

  if (!retryable || exhausted) {
    return db.job.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        lastError: message,
        completedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
      },
    });
  }

  return db.job.update({
    where: { id: job.id },
    data: {
      status: "PENDING",
      lastError: message,
      runAt: backoffFor(job.attempts),
      lockedBy: null,
      lockedAt: null,
    },
  });
}

/**
 * Put a job back without counting the attempt. Used for quiet hours: holding a
 * message until 8am is not a failure, and must not consume a retry.
 */
export async function reschedule(job, runAt, reason) {
  return db.job.update({
    where: { id: job.id },
    data: {
      status: "PENDING",
      runAt,
      lastError: reason ?? null,
      attempts: { decrement: 1 }, // undo the increment from claiming
      lockedBy: null,
      lockedAt: null,
    },
  });
}

/** Update a running job's payload — used to carry an smsLogId into the retry. */
export async function updatePayload(jobId, payload) {
  return db.job.update({ where: { id: jobId }, data: { payload } });
}

/**
 * Return jobs whose worker died. Without this, a crashed worker's jobs sit in
 * RUNNING forever and the messages are never sent.
 */
export async function reclaimStale() {
  const cutoff = new Date(Date.now() - LOCK_TIMEOUT_MS);

  const result = await db.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: cutoff } },
    data: { status: "PENDING", lockedBy: null, lockedAt: null },
  });

  return result.count;
}

/** Release this worker's claims on shutdown, so they run again immediately. */
export async function releaseAll(workerId) {
  const result = await db.job.updateMany({
    where: { status: "RUNNING", lockedBy: workerId },
    data: { status: "PENDING", lockedBy: null, lockedAt: null },
  });

  return result.count;
}

export async function cancelByDedupePrefix(prefix) {
  const result = await db.job.updateMany({
    where: { status: "PENDING", dedupeKey: { startsWith: prefix } },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  return result.count;
}
