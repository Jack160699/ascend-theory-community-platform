import { getCartProduct } from "@/lib/cart/catalog";
import { lineTotal } from "@/lib/cart/format";
import type {
  CreateOrderInput,
  Order,
  OrderItem,
  OrderStatus,
  PaymentProvider,
} from "./types";
import { createOrderId } from "./id";

export type BuildOrderResult =
  | { ok: true; order: Order }
  | { ok: false; error: string };

export function buildOrderFromInput(input: CreateOrderInput): BuildOrderResult {
  if (!input.items.length) {
    return { ok: false, error: "Cart is empty." };
  }

  const items: OrderItem[] = [];
  let currency = "USD";

  for (const line of input.items) {
    const product = getCartProduct(line.slug);
    if (!product) {
      return { ok: false, error: `Unknown product: ${line.slug}` };
    }
    let size: string | undefined;
    if (product.sizes?.length) {
      if (!line.size || !product.sizes.includes(line.size)) {
        return { ok: false, error: `Choose a size for ${product.name}.` };
      }
      size = line.size;
    }
    const quantity = Math.min(
      Math.max(1, Math.floor(line.quantity)),
      product.maxQuantity,
    );
    currency = product.currency;
    items.push({
      slug: product.slug,
      name: product.name,
      dropName: product.dropName,
      price: product.price,
      priceDisplay: product.priceDisplay,
      quantity,
      lineTotal: lineTotal(product, quantity),
      ...(size ? { size } : {}),
    });
  }

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);

  const paymentProvider: PaymentProvider =
    input.paymentMethod === "online"
      ? (input.paymentProvider ?? detectPaymentProvider())
      : "none";

  const status: OrderStatus =
    input.paymentMethod === "online" ? "pending_payment" : "pending_fulfillment";

  const order: Order = {
    id: createOrderId(),
    createdAt: new Date().toISOString(),
    status,
    paymentMethod: input.paymentMethod,
    paymentProvider,
    currency,
    subtotal,
    items,
    customer: input.customer,
    fulfillment: { provider: "manual" },
  };

  return { ok: true, order };
}

function detectPaymentProvider(): PaymentProvider {
  if (process.env.STRIPE_SECRET_KEY) return "stripe";
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    return "razorpay";
  }
  return "none";
}
