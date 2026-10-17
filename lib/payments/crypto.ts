import crypto from "node:crypto";

export type CheckoutSignatureParams = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

/**
 * Cryptographically verifies a Razorpay checkout callback signature using HMAC SHA256.
 * Secret is retrieved from process.env.RAZORPAY_KEY_SECRET unless explicitly supplied.
 */
export function verifyRazorpayCheckoutSignature(
  params: CheckoutSignatureParams,
  secret?: string
): boolean {
  const keySecret = secret ?? process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return false;

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = params;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return false;
  }

  const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(payload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "utf-8"),
      Buffer.from(razorpay_signature, "utf-8")
    );
  } catch {
    return false;
  }
}

/**
 * Cryptographically verifies a Razorpay webhook request signature using HMAC SHA256.
 * Secret is retrieved from process.env.RAZORPAY_WEBHOOK_SECRET unless explicitly supplied.
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret?: string
): boolean {
  const webhookSecret = secret ?? process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret || !signatureHeader) return false;

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "utf-8"),
      Buffer.from(signatureHeader.trim(), "utf-8")
    );
  } catch {
    return false;
  }
}
