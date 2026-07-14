import { FOLLOW_UPS, delayLabel } from "../abandoned.js";
import { validateTemplate, variablesUsed } from "../templates.server.js";

// Save-time validation for the abandoned cart settings.
//
// Two of these catch traps that are invisible in the editor and would otherwise
// surface as a reminder that silently never sends, days later:
//
//   - A message using {{discount_code}} while the discount is switched off. The
//     code renders empty, and an empty discount_code blocks the send, so the
//     whole reminder is dropped and the merchant never hears about it.
//   - Delays that do not increase. Every delay is measured from abandonment, so
//     a follow-up 2 set to 1 hour when follow-up 1 is also at 1 hour is already
//     overdue the moment it is scheduled — the customer gets both texts at once.

export function validateAbandonedSettings(form) {
  const errors = {};
  const global = [];

  const discountEnabled = form.get("discountEnabled") === "true";
  const discountCode = String(form.get("discountCode") ?? "").trim();

  if (discountEnabled && !discountCode) {
    global.push(
      "Enter the discount code, or switch the discount off. An empty code stops every reminder that uses it from being sent.",
    );
  }

  const enabled = [];

  for (const followUp of FOLLOW_UPS) {
    if (form.get(`enabled:${followUp.key}`) !== "true") continue;

    const body = String(form.get(`body:${followUp.key}`) ?? "");
    const delayHours = Number(form.get(`delayHours:${followUp.key}`) ?? 1);
    const includeDiscount = form.get(`includeDiscount:${followUp.key}`) === "true";

    enabled.push({ ...followUp, delayHours });

    const messages = [...validateTemplate(followUp.key, body).errors];

    if (variablesUsed(body).includes("discount_code")) {
      if (!discountEnabled) {
        messages.push(
          "This message uses {{discount_code}} but the discount is switched off, so it would never be sent. Switch the discount on, or take the code out of the message.",
        );
      } else if (!includeDiscount) {
        messages.push(
          "This message uses {{discount_code}} but 'Include the discount code' is unticked, so it would never be sent.",
        );
      }
    }

    if (messages.length > 0) errors[followUp.key] = messages;
  }

  for (let i = 1; i < enabled.length; i++) {
    const previous = enabled[i - 1];
    const current = enabled[i];

    if (current.delayHours <= previous.delayHours) {
      (errors[current.key] ??= []).push(
        `This is sent ${delayLabel(current.delayHours).toLowerCase()}, which is not after ${previous.name} (${delayLabel(previous.delayHours).toLowerCase()}). The customer would get both messages at once.`,
      );
    }
  }

  return { ok: Object.keys(errors).length === 0 && global.length === 0, errors, global };
}
