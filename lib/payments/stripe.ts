import type { Order } from "@/lib/orders/types";
import Stripe from "stripe";

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export function isStripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export async function createStripeCheckoutSession(
  order: Order,
  origin: string,
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.customer.email,
    line_items: order.items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: Math.round(item.price * 100),
        product_data: {
          name: item.size ? `${item.name} — Size ${item.size}` : item.name,
          description: item.dropName,
        },
      },
    })),
    metadata: {
      orderId: order.id,
    },
    success_url: `${origin}/checkout/confirmation?orderId=${encodeURIComponent(order.id)}&paid=1`,
    cancel_url: `${origin}/checkout?cancelled=1`,
  });

  return session.url ?? null;
}

export async function markOrderPaidFromStripeSession(
  sessionId: string,
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") return null;
  const orderId = session.metadata?.orderId;
  if (!orderId) return null;
  return orderId;
}
