import { randomUUID } from "node:crypto";
import { getHandler } from "./handlers.server.js";
import { claim, complete, fail, reclaimStale, releaseAll, reschedule } from "./queue.server.js";

// The worker.
//
// Polls the Job table, claims work, runs it under a rate limit, and gets out of
// the way on shutdown. Designed to be run as a separate process (`npm run
// worker`) — never inside a web request, where a 10,000-message campaign would
// time out long before it finished.
//
// Rate limiting is not politeness. BD gateways throttle aggressively and will
// start rejecting (and in some cases blocking the sender ID) if a campaign
// fires thousands of requests a second. The bucket below is the thing standing
// between a merchant's campaign and their sender ID being suspended.

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
const RATE_PER_SECOND = Number(process.env.SMS_RATE_PER_SECOND ?? 10);
const RECLAIM_EVERY_MS = 60_000;

/** Token bucket. Refills continuously; a send waits for a token. */
function createRateLimiter(perSecond) {
  let tokens = perSecond;
  let last = Date.now();

  return async function take() {
    for (;;) {
      const now = Date.now();
      tokens = Math.min(perSecond, tokens + ((now - last) / 1000) * perSecond);
      last = now;

      if (tokens >= 1) {
        tokens -= 1;
        return;
      }

      const waitMs = Math.ceil(((1 - tokens) / perSecond) * 1000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createWorker({ workerId = `worker-${randomUUID().slice(0, 8)}` } = {}) {
  const takeToken = createRateLimiter(RATE_PER_SECOND);

  let running = false;
  let stopping = false;
  const inFlight = new Set();

  async function runJob(job) {
    try {
      await takeToken();

      const handler = getHandler(job.type);
      const outcome = await handler(job);

      if (outcome?.reschedule) {
        await reschedule(job, outcome.reschedule, outcome.reason);
        console.log(
          `[${workerId}] ${job.type} ${job.id} deferred to ${outcome.reschedule.toISOString()} (${outcome.reason ?? ""})`,
        );
        return;
      }

      await complete(job.id);
      console.log(`[${workerId}] ${job.type} ${job.id} done`);
    } catch (error) {
      const retryable = error.retryable !== false;

      await fail(job, error, { retryable });

      console.warn(
        `[${workerId}] ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}${retryable ? "" : ", permanent"}): ${error.message}`,
      );
    }
  }

  async function tick() {
    const free = CONCURRENCY - inFlight.size;
    if (free <= 0) return;

    const jobs = await claim(workerId, free);

    for (const job of jobs) {
      const promise = runJob(job).finally(() => inFlight.delete(promise));
      inFlight.add(promise);
    }
  }

  async function loop() {
    running = true;
    let lastReclaim = 0;

    console.log(
      `[${workerId}] started — concurrency ${CONCURRENCY}, ${RATE_PER_SECOND} SMS/sec, polling every ${POLL_INTERVAL_MS}ms`,
    );

    while (!stopping) {
      try {
        // Pick up jobs abandoned by a worker that died mid-run.
        if (Date.now() - lastReclaim > RECLAIM_EVERY_MS) {
          const reclaimed = await reclaimStale();
          if (reclaimed > 0) {
            console.log(`[${workerId}] reclaimed ${reclaimed} stale job(s)`);
          }
          lastReclaim = Date.now();
        }

        await tick();
      } catch (error) {
        // The loop must never die. A database blip should not take the worker
        // down and silently stop every merchant's SMS.
        console.error(`[${workerId}] poll error:`, error.message);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    // Let in-flight work finish, then hand back anything still claimed so
    // another worker picks it up immediately instead of waiting for the stale
    // lock to expire.
    await Promise.allSettled([...inFlight]);
    const released = await releaseAll(workerId);

    running = false;
    console.log(`[${workerId}] stopped — released ${released} claim(s)`);
  }

  return {
    workerId,
    start: loop,
    stop: () => {
      stopping = true;
    },
    isRunning: () => running,
    inFlightCount: () => inFlight.size,
  };
}
