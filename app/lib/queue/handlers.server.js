import { SendOutcome, retrySend, sendSms } from "../sms/send.server.js";
import { updatePayload } from "./queue.server.js";

// Job handlers.
//
// A handler either returns (job done), throws (job retried with backoff), or
// returns { reschedule } to be put back without burning an attempt.

export class PermanentError extends Error {
  constructor(message) {
    super(message);
    this.retryable = false;
  }
}

/**
 * SEND_SMS — one message.
 *
 * The subtlety: sendSms() reserves an SmsLog row keyed on dedupeKey as its
 * idempotency barrier. On a retry, calling sendSms() again would collide with
 * that row and return DUPLICATE, so the message would never actually be retried.
 * So the first attempt calls sendSms(), and any retry calls retrySend() against
 * the row the first attempt left behind. The smsLogId is carried in the payload.
 */
async function handleSendSms(job) {
  const payload = job.payload;

  const result = payload.smsLogId
    ? await retrySend(payload.smsLogId)
    : await sendSms(payload);

  switch (result.outcome) {
    case SendOutcome.SENT:
    case SendOutcome.DUPLICATE:
      return;

    case SendOutcome.SKIPPED:
      // Blacklisted, no consent, bad number, no credits. Nothing was charged and
      // retrying changes nothing — the SmsLog row records why.
      return;

    case SendOutcome.DEFERRED:
      // Quiet hours. Not a failure: put it back for later, no attempt consumed.
      return { reschedule: result.runAt, reason: result.reason };

    case SendOutcome.FAILED: {
      if (!result.retryable) {
        throw new PermanentError(result.reason ?? "The gateway rejected this message");
      }

      // Carry the reserved row into the next attempt so the retry replaces it
      // rather than colliding with it.
      if (result.smsLogId && result.smsLogId !== payload.smsLogId) {
        await updatePayload(job.id, { ...payload, smsLogId: result.smsLogId });
      }

      throw new Error(result.reason ?? "The gateway could not be reached");
    }

    default:
      throw new PermanentError(`Unknown send outcome: ${result.outcome}`);
  }
}

// Phases 4-6 register their handlers here. A job type with no handler is buried
// rather than retried forever.
export const HANDLERS = {
  SEND_SMS: handleSendSms,
};

export function getHandler(type) {
  const handler = HANDLERS[type];

  if (!handler) {
    throw new PermanentError(`No handler is registered for job type ${type}`);
  }

  return handler;
}
