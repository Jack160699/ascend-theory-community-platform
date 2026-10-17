import type { Order } from "@/lib/orders/types";
import { createRazorpayCheckout, isRazorpayEnabled } from "./razorpay";
import { createStripeCheckoutSession, isStripeEnabled } from "./stripe";

export type PaymentSessionResult = {
  paymentUrl: string;
  paymentReference?: string;
};

export function getAvailablePaymentProviders(): ("stripe" | "razorpay")[] {
  const providers: ("stripe" | "razorpay")[] = [];
  if (isStripeEnabled()) providers.push("stripe");
  if (isRazorpayEnabled()) providers.push("razorpay");
  return providers;
}

export async function createPaymentSession(
  order: Order,
  origin: string,
): Promise<PaymentSessionResult | null> {
  if (order.paymentProvider === "stripe" && isStripeEnabled()) {
    const url = await createStripeCheckoutSession(order, origin);
    if (url) return { paymentUrl: url };
  }

  if (order.paymentProvider === "razorpay" && isRazorpayEnabled()) {
    const result = await createRazorpayCheckout(order, origin);
    if (result) {
      return {
        paymentUrl: result.paymentUrl,
        paymentReference: result.orderId,
      };
    }
  }

  if (isStripeEnabled()) {
    const url = await createStripeCheckoutSession(order, origin);
    if (url) return { paymentUrl: url };
  }

  return null;
}

export { isStripeEnabled, isRazorpayEnabled };
export * from "./crypto";
export * from "./razorpay";
export * from "./store-payments";
