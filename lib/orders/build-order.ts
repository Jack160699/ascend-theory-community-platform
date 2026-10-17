import { getCartProduct } from "@/lib/cart/catalog";
import { lineTotal } from "@/lib/cart/format";
import { getAuthoritativeVariantForCheckout } from "@/lib/wearables/store";
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

export async function buildOrderFromInputAsync(input: CreateOrderInput): Promise<BuildOrderResult> {
  if (!input.items || !input.items.length) {
    return { ok: false, error: "Cart is empty." };
  }

  const items: OrderItem[] = [];
  let currency = "INR";

  for (const line of input.items) {
    // Require exact sellable variant identity (sku OR variantId)
    if (!line.sku && !line.variantId) {
      return { ok: false, error: `Variant identity (SKU or variantId) is required for '${line.slug || "cart item"}'` };
    }

    // Authoritative Server-side Variant & Product Resolution from DB Store
    const varResult = await getAuthoritativeVariantForCheckout({
      slug: line.slug,
      sku: line.sku,
      variantId: line.variantId,
      size: line.size,
      color: line.color,
    });

    if (!varResult.ok) {
      return { ok: false, error: `Checkout validation failed for '${line.slug || line.sku}': ${varResult.error}` };
    }

    const { product, variant } = varResult;
    const authoritativePrice = variant.pricePaise / 100;
    currency = product.currency || "INR";
    const quantity = Math.min(Math.max(1, Math.floor(line.quantity)), 10);
    const itemLineTotal = Math.round(authoritativePrice * quantity * 100) / 100;

    const { buildAuthoritativeManufacturingIdentity } = await import("@/lib/inventory/reuse-engine");
    const { hasSupabaseConfig } = await import("@/lib/supabase/env");
    let mfgHash: string | undefined;
    let mfgSnapshot: Record<string, unknown> | undefined;
    try {
      const mfgRes = await buildAuthoritativeManufacturingIdentity(product.id, variant.id, variant.sku);
      mfgHash = mfgRes.hash;
      mfgSnapshot = mfgRes.snapshot as unknown as Record<string, unknown>;
    } catch (err) {
      console.warn("[BuildOrder] Could not build manufacturing identity:", err);
      if (hasSupabaseConfig()) {
        return { ok: false, error: `Failed to compute authoritative manufacturing identity for product '${product.title}' (${variant.sku}).` };
      }
    }

    items.push({
      productId: product.id,
      variantId: variant.id,
      slug: product.slug,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      name: product.title,
      dropName: product.subtitle || "Ascend Release",
      price: authoritativePrice,
      priceDisplay: new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(authoritativePrice),
      quantity,
      lineTotal: itemLineTotal,
      manufacturingIdentityHash: mfgHash,
      manufacturingSnapshotJson: mfgSnapshot,
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
    const quantity = Math.min(
      Math.max(1, Math.floor(line.quantity)),
      product.maxQuantity,
    );
    currency = product.currency;
    items.push({
      slug: product.slug,
      sku: line.sku || `${product.slug.toUpperCase()}-S`,
      size: line.size || "S",
      color: line.color || "black",
      name: product.name,
      dropName: product.dropName,
      price: product.price,
      priceDisplay: product.priceDisplay,
      quantity,
      lineTotal: lineTotal(product, quantity),
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
