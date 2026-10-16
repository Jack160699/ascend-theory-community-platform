import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { getOrder } from "./store";
import type { Order, OrderItem, OrderStatus, PaymentMethod, PaymentProvider } from "./types";

export type AuthoritativeOrderDetails = {
  id: string;
  status: string;
  paymentStatus: string;
  totalPaise: number;
  currency: string;
  paymentReference?: string;
  paymentProvider?: string;
};

export type AuthoritativeOrderResult =
  | { ok: true; data: AuthoritativeOrderDetails }
  | { ok: false; error: string; dbError?: boolean };

/**
 * Maps an Ascend Theory Order domain entity to the Supabase database table format.
 */
export async function saveSupabaseOrder(order: Order): Promise<void> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    throw new Error("[OrderStore] Supabase service role client is unconfigured.");
  }

  const subtotalPaise = Math.round((order.subtotal || 0) * 100);
  const totalPaise = subtotalPaise;

  let dbStatus = "pending";
  if (order.status === "created") dbStatus = "created";
  else if (order.status === "paid") dbStatus = "paid";
  else if (order.status === "cancelled") dbStatus = "cancelled";
  else if (order.status === "refunded") dbStatus = "refunded";

  const dbPaymentStatus =
    order.status === "paid"
      ? "captured"
      : order.status === "refunded"
      ? "refunded"
      : "unpaid";

  const dbFulfillmentStatus =
    order.status === "pending_fulfillment" ? "processing" : "unfulfilled";

  const paymentMethod: PaymentMethod = order.paymentMethod || (order.isCod ? "cod" : "online");
  const paymentProvider: PaymentProvider = order.paymentProvider || "razorpay";

  // Upsert master order record with durable payment_method and payment_provider
  const { error: orderError } = await supabase.from("orders").upsert({
    id: order.id,
    status: dbStatus,
    payment_status: dbPaymentStatus,
    fulfillment_status: dbFulfillmentStatus,
    payment_method: paymentMethod,
    payment_provider: paymentProvider,
    subtotal_paise: subtotalPaise,
    total_paise: totalPaise,
    currency: order.currency || "INR",
    shipping_address: order.customer as unknown as Record<string, unknown>,
    cod_status: order.codStatus || (paymentMethod === "cod" ? "COD_PENDING_CONFIRMATION" : "NOT_COD"),
    advance_required: order.advanceRequired || false,
    advance_amount_paise: order.advanceAmountPaise || 0,
    advance_payment_id: order.advancePaymentId || null,
    advance_status: order.advanceStatus || "none",
    cod_confirmation_token_hash: order.codConfirmationTokenHash || null,
    customer_read_token_hash: order.customerReadTokenHash || null,
    created_at: order.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (orderError) {
    console.error("[OrderStore] Supabase order upsert error:", orderError);
    throw new Error(`Failed to persist order to Supabase: ${orderError.message}`);
  }

  // Persist order items with immutable purchased snapshot
  if (order.items && order.items.length > 0) {
    const itemRecords = order.items.map((item) => ({
      order_id: order.id,
      product_id: item.productId ?? null,
      variant_id: item.variantId ?? null,
      sku: item.sku || item.slug,
      title: item.name,
      size: item.size || "STD",
      color: item.color || "DEFAULT",
      unit_price_paise: Math.round(item.price * 100),
      quantity: item.quantity,
      total_price_paise: Math.round(item.lineTotal * 100),
      snapshot_json: (item as unknown) as Record<string, unknown>,
      manufacturing_identity_hash: item.manufacturingIdentityHash || null,
      manufacturing_snapshot_json: item.manufacturingSnapshotJson || null,
    }));

    const { error: itemsError } = await supabase.from("order_items").upsert(itemRecords, {
      onConflict: "order_id,sku",
      ignoreDuplicates: true,
    });

    if (itemsError) {
      console.error("[OrderStore] Order items upsert error:", itemsError);
      throw new Error(`Failed to persist order items to Supabase: ${itemsError.message}`);
    }
  }

  // Persist initial payment mapping if paymentReference is present
  if (order.paymentReference) {
    const { error: paymentError } = await supabase.from("payments").upsert(
      {
        order_id: order.id,
        provider: paymentProvider,
        provider_order_id: order.paymentReference,
        amount_paise: totalPaise,
        currency: order.currency || "INR",
        status: order.status === "paid" ? "captured" : "created",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider_order_id" }
    );

    if (paymentError) {
      console.error("[OrderStore] Payment record upsert error:", paymentError);
      throw new Error(`Failed to persist payment mapping to Supabase: ${paymentError.message}`);
    }
  }
}

/**
 * Retrieves authoritative order details directly from DB for payment calculation and verification.
 * Fails closed on database errors.
 */
export async function getAuthoritativeOrderDetails(
  orderId: string
): Promise<AuthoritativeOrderResult> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    const isProduction = process.env.NODE_ENV === "production";
    const hasConfig = hasSupabaseConfig();
    if (isProduction || hasConfig) {
      return { ok: false, error: "Supabase service client unconfigured", dbError: true };
    }
    // Dev/Test memory fallback
    const localOrder = await getOrder(orderId);
    if (!localOrder) return { ok: false, error: "Order not found" };
    return {
      ok: true,
      data: {
        id: localOrder.id,
        status: localOrder.status,
        paymentStatus: localOrder.status === "paid" ? "captured" : "unpaid",
        totalPaise: Math.round(localOrder.subtotal * 100),
        currency: localOrder.currency || "INR",
        paymentReference: localOrder.paymentReference,
        paymentProvider: localOrder.paymentProvider,
      },
    };
  }

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select("id, status, payment_status, total_paise, subtotal_paise, currency, payment_method, payment_provider")
    .eq("id", orderId)
    .single();

  if (orderError) {
    if (orderError.code === "PGRST116") {
      return { ok: false, error: "Order not found" };
    }
    console.error("[OrderStore] Order query error:", orderError);
    return { ok: false, error: `Database error querying order: ${orderError.message}`, dbError: true };
  }

  if (!orderRow) {
    return { ok: false, error: "Order not found" };
  }

  const { data: paymentRow, error: paymentError } = await supabase
    .from("payments")
    .select("provider_order_id, provider, amount_paise, currency, status")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (paymentError) {
    console.error("[OrderStore] Payment row query error:", paymentError);
    return { ok: false, error: `Database error querying payment mapping: ${paymentError.message}`, dbError: true };
  }

  const totalPaise = Number(orderRow.total_paise || orderRow.subtotal_paise || 0);

  return {
    ok: true,
    data: {
      id: orderRow.id,
      status: orderRow.status,
      paymentStatus: orderRow.payment_status,
      totalPaise,
      currency: orderRow.currency || "INR",
      paymentReference: paymentRow?.provider_order_id || undefined,
      paymentProvider: orderRow.payment_provider || paymentRow?.provider || undefined,
    },
  };
}

/**
 * Retrieves an order from Supabase database.
 * Restores real order_items.id into OrderItem.orderItemId.
 */
export async function getSupabaseOrder(orderId: string): Promise<Order | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !orderRow) return null;

  const { data: itemRows, error: itemsError } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId);

  if (itemsError) {
    console.error("[OrderStore] Order items fetch error:", itemsError);
    return null;
  }

  const { data: paymentRow, error: paymentError } = await supabase
    .from("payments")
    .select("provider_order_id, provider, status")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (paymentError) {
    console.error("[OrderStore] Payment row query error:", paymentError);
    return null;
  }

  const items: OrderItem[] = (itemRows || []).map((row) => {
    const snap = (row.snapshot_json || {}) as Partial<OrderItem>;
    return {
      orderItemId: row.id,
      productId: row.product_id || snap.productId || undefined,
      variantId: row.variant_id || snap.variantId || undefined,
      slug: snap.slug || row.sku || "",
      sku: row.sku || snap.sku || undefined,
      size: row.size || snap.size || undefined,
      color: row.color || snap.color || undefined,
      name: row.title || snap.name || "",
      dropName: snap.dropName || "Ascend Drop",
      price: Number(row.unit_price_paise || 0) / 100,
      pricePaise: Number(row.unit_price_paise || 0),
      priceDisplay: snap.priceDisplay || `₹${Number(row.unit_price_paise || 0) / 100}`,
      quantity: row.quantity,
      lineTotal: Number(row.total_price_paise || 0) / 100,
      manufacturingIdentityHash: row.manufacturing_identity_hash || snap.manufacturingIdentityHash || undefined,
      manufacturingSnapshotJson: row.manufacturing_snapshot_json || snap.manufacturingSnapshotJson || undefined,
    };
  });

  const customerObj = (orderRow.shipping_address || {}) as unknown as Order["customer"];

  let domainStatus: OrderStatus = "pending_payment";
  if (orderRow.status === "paid" || orderRow.payment_status === "captured") {
    domainStatus = "paid";
  } else if (orderRow.status === "cancelled") {
    domainStatus = "cancelled";
  } else if (orderRow.status === "refunded" || orderRow.payment_status === "refunded") {
    domainStatus = "refunded";
  } else if (orderRow.status === "created") {
    domainStatus = "created";
  } else if (orderRow.fulfillment_status === "processing" || orderRow.fulfillment_status === "fulfilled") {
    domainStatus = "pending_fulfillment";
  }

  const paymentMethod: PaymentMethod =
    orderRow.payment_method === "cod"
      ? "cod"
      : orderRow.payment_method === "online"
      ? "online"
      : paymentRow?.provider === "cod"
      ? "cod"
      : "online";

  const paymentProvider: PaymentProvider =
    (orderRow.payment_provider as PaymentProvider) ||
    (paymentRow?.provider as PaymentProvider) ||
    "razorpay";

  return {
    id: orderRow.id,
    createdAt: orderRow.created_at,
    status: domainStatus,
    paymentMethod,
    paymentProvider,
    paymentStatus: orderRow.payment_status || (domainStatus === "paid" ? "captured" : "unpaid"),
    isCod: paymentMethod === "cod",
    currency: orderRow.currency || "INR",
    subtotal: Number(orderRow.subtotal_paise || orderRow.total_paise || 0) / 100,
    items,
    customer: customerObj,
    shippingAddress: customerObj,
    paymentReference: paymentRow?.provider_order_id || undefined,
    codStatus: orderRow.cod_status || (paymentMethod === "cod" ? "COD_PENDING_CONFIRMATION" : "NOT_COD"),
    advanceRequired: orderRow.advance_required || false,
    advanceAmountPaise: Number(orderRow.advance_amount_paise || 0),
    advancePaymentId: orderRow.advance_payment_id || undefined,
    advanceStatus: orderRow.advance_status || "none",
    codConfirmationTokenHash: orderRow.cod_confirmation_token_hash || undefined,
    customerReadTokenHash: orderRow.customer_read_token_hash || undefined,
  };
}
