import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  VerifyResult,
  findOtpByToken,
  markOrderConfirmed,
  verifyCode,
} from "../../lib/orders/cod-otp.server";
import styles from "./styles.module.css";

// The customer-facing COD confirmation page.
//
// This is the only route in the app with no Shopify session — the person opening
// it is a shopper who tapped a link in an SMS, not a merchant. It runs outside
// the embedded admin entirely.
//
// The confirmation is a POST, never a GET. Link previews, WhatsApp unfurlers and
// antivirus scanners follow links automatically; if opening the URL confirmed the
// order, every order would confirm itself the moment the SMS was scanned, and the
// feature would silently do nothing.

export const loader = async ({ params }) => {
  const otp = await findOtpByToken(params.token);

  if (!otp) {
    // Deliberately vague. Telling a stranger "that token does not exist" turns
    // this page into an oracle for probing tokens.
    throw new Response("Not found", { status: 404 });
  }

  return {
    orderNumber: otp.orderNumber,
    orderTotal: otp.orderTotal,
    status: otp.status,
    expired: otp.expiresAt < new Date(),
    attemptsLeft: Math.max(0, otp.maxAttempts - otp.attempts),
  };
};

export const action = async ({ request, params }) => {
  const form = await request.formData();
  const code = String(form.get("code") ?? "");

  const { result, otp, remaining } = await verifyCode(params.token, code);

  if (result === VerifyResult.OK) {
    await markOrderConfirmed(otp.shop, otp.orderId);
    return { ok: true };
  }

  const messages = {
    [VerifyResult.NOT_FOUND]: "This confirmation link is not valid.",
    [VerifyResult.ALREADY_VERIFIED]: "This order is already confirmed.",
    [VerifyResult.EXPIRED]:
      "This confirmation link has expired. Please contact the shop.",
    [VerifyResult.TOO_MANY_ATTEMPTS]:
      "Too many incorrect attempts. Please contact the shop to confirm your order.",
    [VerifyResult.WRONG_CODE]: remaining
      ? `That code is not correct. ${remaining} ${remaining === 1 ? "try" : "tries"} left.`
      : "That code is not correct.",
  };

  return {
    ok: result === VerifyResult.ALREADY_VERIFIED,
    error: messages[result] ?? "Something went wrong.",
  };
};

export default function ConfirmOrder() {
  const { orderNumber, orderTotal, status, expired, attemptsLeft } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const submitting = navigation.state === "submitting";
  const confirmed = actionData?.ok || status === "VERIFIED";
  const locked = status === "FAILED" || attemptsLeft === 0;
  const dead = expired || status === "EXPIRED";

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {confirmed ? (
          <>
            <div className={`${styles.icon} ${styles.success}`}>✓</div>
            <h1 className={styles.heading}>Order confirmed</h1>
            <p className={styles.text}>
              Thank you. Order #{orderNumber} is confirmed and will be prepared
              for delivery.
            </p>
          </>
        ) : dead ? (
          <>
            <div className={styles.icon}>!</div>
            <h1 className={styles.heading}>This link has expired</h1>
            <p className={styles.text}>
              Please contact the shop to confirm order #{orderNumber}.
            </p>
          </>
        ) : locked ? (
          <>
            <div className={styles.icon}>!</div>
            <h1 className={styles.heading}>Too many attempts</h1>
            <p className={styles.text}>
              Please contact the shop to confirm order #{orderNumber}.
            </p>
          </>
        ) : (
          <>
            <h1 className={styles.heading}>Confirm your order</h1>

            <dl className={styles.summary}>
              <div className={styles.row}>
                <dt>Order</dt>
                <dd>#{orderNumber}</dd>
              </div>
              {orderTotal ? (
                <div className={styles.row}>
                  <dt>Total (cash on delivery)</dt>
                  <dd>{orderTotal}</dd>
                </div>
              ) : null}
            </dl>

            <p className={styles.text}>
              Enter the 6-digit code from the SMS we sent you.
            </p>

            <Form method="post" className={styles.form}>
              <input
                className={styles.input}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                aria-label="6-digit confirmation code"
                required
              />

              {actionData?.error ? (
                <p className={styles.error}>{actionData.error}</p>
              ) : null}

              <button className={styles.button} type="submit" disabled={submitting}>
                {submitting ? "Confirming…" : "Confirm my order"}
              </button>
            </Form>

            <p className={styles.hint}>
              Your order will not be delivered until it is confirmed.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
