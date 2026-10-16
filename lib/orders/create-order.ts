/**
 * Phase 7 Authoritative Order Creation Orchestrator
 * Ensures COD checkout initializes in COD_PENDING_CONFIRMATION with 0 fulfillments,
 * generates a 32-byte confirmationToken, stores its hash server-side, and excludes the token hash from customer DTOs.
 */

import crypto from "node:crypto";
import type { Order, CreateOrderResult, CreateOrderInput } from "./types";
import { saveOrder, getOrderAdmin } from "./store";
import { buildOrderFromInputAsync } from "./build-order";
import { createPaymentSession, getAvailablePaymentProviders } from "@/lib/payments";

export async function createOrder(
  input: CreateOrderInput,
  origin: string,
): Promise<
  | { ok: true; data: CreateOrderResult }
  | { ok: false; error: string; status: number }
> {
  const built = await buildOrderFromInputAsync(input);
  if (!built.ok) {
    return { ok: false, error: built.error, status: 400 };
  }

  let order = built.order;

  const customerReadToken = crypto.randomBytes(32).toString("hex");
  const customerReadTokenHash = crypto.createHash("sha256").update(customerReadToken).digest("hex");
  order = {
    ...order,
    customerReadTokenHash,
  };

  let confirmationToken: string | undefined;

  if (order.paymentMethod === "cod") {
    confirmationToken = crypto.randomBytes(32).toString("hex");
    const codConfirmationTokenHash = crypto.createHash("sha256").update(confirmationToken).digest("hex");

    order = {
      ...order,
      isCod: true,
      codStatus: "COD_PENDING_CONFIRMATION",
      codConfirmationTokenHash,
      advanceRequired: false,
      advanceAmountPaise: 0,
      advanceStatus: "none" as import("@/lib/cod/types").AdvanceStatus,
    };

    await saveOrder(order);

    const { codConfirmationTokenHash: _hash, customerReadTokenHash: _rhash, ...sanitizedOrder } = order;

    return {
      ok: true,
      data: {
        order: sanitizedOrder,
        confirmationToken,
        customerReadToken,
      },
    };
  }

  const providers = getAvailablePaymentProviders();
  if (providers.length === 0) {
    return {
      ok: false,
      error: "Online payment is not configured. Choose Cash on Delivery or contact support.",
      status: 503,
    };
  }
  if (
    order.paymentProvider !== "none" &&
    !providers.includes(order.paymentProvider as "stripe" | "razorpay")
  ) {
    order = {
      ...order,
      paymentProvider: providers[0]!,
    };
  }

  await saveOrder(order);

  const payment = await createPaymentSession(order, origin);
  if (!payment) {
    return {
      ok: false,
      error: "Could not start payment session. Try again or use Cash on Delivery.",
      status: 502,
    };
  }

  order = {
    ...order,
    paymentReference: payment.paymentReference,
  };
  await saveOrder(order);

  const { customerReadTokenHash: _rhash, ...sanitizedPrepaidOrder } = order;

  return {
    ok: true,
    data: {
      order: sanitizedPrepaidOrder,
      paymentUrl: payment.paymentUrl,
      customerReadToken,
    },
  };
}

/**
 * @deprecated Unauthenticated order status mutation is prohibited.
 * Use verifyRazorpayCheckoutCallback or handleRazorpayWebhook for payment verification.
 */
export async function confirmOrderPaid(orderId: string): Promise<void> {
  const order = await getOrderAdmin(orderId);
  if (!order) return;

  // Unauthenticated browser navigation cannot mark order paid
  if (order.status !== "paid") {
    throw new Error(
      `Cannot confirm order ${orderId} as paid without verified provider signature.`
    );
  }
}
