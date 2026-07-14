// A process-wide token bucket for outbound SMS.
//
// This is shared, not per-job, and that matters: a SEND_CAMPAIGN job sends
// hundreds of messages inside a single job. If the limiter lived in the worker's
// job loop it would take one token per *job*, and a campaign would fire as fast
// as the gateway would accept — which is how a sender ID gets suspended.
//
// Every outbound message takes a token, whoever is sending it.

const RATE_PER_SECOND = Number(process.env.SMS_RATE_PER_SECOND ?? 10);

let tokens = RATE_PER_SECOND;
let last = Date.now();

/** Resolves when it is this caller's turn to send. */
export async function takeSendToken() {
  for (;;) {
    const now = Date.now();

    tokens = Math.min(
      RATE_PER_SECOND,
      tokens + ((now - last) / 1000) * RATE_PER_SECOND,
    );
    last = now;

    if (tokens >= 1) {
      tokens -= 1;
      return;
    }

    const waitMs = Math.ceil(((1 - tokens) / RATE_PER_SECOND) * 1000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export const ratePerSecond = RATE_PER_SECOND;
