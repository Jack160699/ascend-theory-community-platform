import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Order, OrderItem, PaymentMethod } from "./types";
import { hasSupabaseServiceConfig } from "@/lib/supabase/env";
import { saveSupabaseOrder, getSupabaseOrder } from "./supabase-store";

const memoryOrders = new Map<string, Order>();

function ordersDirectory(): string {
  if (process.env.ORDERS_DATA_DIR) {
    return process.env.ORDERS_DATA_DIR;
  }
  return path.join(process.cwd(), "data", "orders");
}

function orderFilePath(orderId: string): string {
  const safe = orderId.replace(/[^a-zA-Z0-9-]/g, "");
  return path.join(ordersDirectory(), `${safe}.json`);
}

/**
 * Persists an order. Enforces Supabase database persistence in production.
 * Refuses insecure /tmp file fallback in production if Supabase is missing.
 */
export async function saveOrder(order: Order): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  const hasSupabase = hasSupabaseServiceConfig();

  if (isProduction && !hasSupabase) {
    throw new Error(
      "[OrderStore FATAL] Insecure file/memory fallback is prohibited in production. Configure SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL."
    );
  }

  if (hasSupabase) {
    try {
      await saveSupabaseOrder(order);
      memoryOrders.set(order.id, order);
      return;
    } catch (err) {
      if (isProduction) {
        throw err;
      }
      console.warn("[OrderStore] Supabase save failed, using dev fallback:", err);
    }
  }

  // Dev/local testing storage fallback
  memoryOrders.set(order.id, order);
  try {
    const dir = ordersDirectory();
    await mkdir(dir, { recursive: true });
    await writeFile(orderFilePath(order.id), JSON.stringify(order, null, 2), "utf8");
  } catch (err) {
    console.warn("[OrderStore] Local dev file store notice:", err);
  }

  console.info("[OrderStore] Order saved (dev mode):", order.id, order.status);
}

/**
 * Retrieves an order by ID.
 */
export async function getOrder(orderId: string): Promise<Order | null> {
  const isProduction = process.env.NODE_ENV === "production";
  const hasSupabase = hasSupabaseServiceConfig();

  if (isProduction && !hasSupabase) {
    throw new Error(
      "[OrderStore FATAL] Insecure file/memory fallback is prohibited in production."
    );
  }

  if (hasSupabase) {
    try {
      const dbOrder = await getSupabaseOrder(orderId);
      if (dbOrder) {
        memoryOrders.set(dbOrder.id, dbOrder);
        return dbOrder;
      }
    } catch (err) {
      if (isProduction) throw err;
    }
  }

  const cached = memoryOrders.get(orderId);
  if (cached) return cached;

  try {
    const raw = await readFile(orderFilePath(orderId), "utf8");
    const order = JSON.parse(raw) as Order;
    memoryOrders.set(order.id, order);
    return order;
  } catch {
    return null;
  }
}

/**
 * Patches and updates an existing order.
 */
export async function updateOrder(
  orderId: string,
  patch: Partial<Order>
): Promise<Order | null> {
  const existing = await getOrder(orderId);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  await saveOrder(next);
  return next;
}

export const getOrderAdmin = getOrder;
export const saveOrderAdmin = saveOrder;

export async function getAllOrdersAdmin(): Promise<Order[]> {
  const isProduction = process.env.NODE_ENV === "production";
  const hasSupabase = hasSupabaseServiceConfig();

  if (hasSupabase) {
    const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      throw new Error("[OrderStore FATAL] Supabase service client initialization failed.");
    }

    const { data: orderRows, error: orderErr } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (orderErr) {
      console.error("[OrderStore] DB error fetching all orders:", orderErr);
      throw new Error(`Failed to fetch orders from Supabase: ${orderErr.message}`);
    }

    if (!orderRows || orderRows.length === 0) {
      return [];
    }

    const orderIds = orderRows.map((r) => r.id);
    const { data: itemRows, error: itemErr } = await supabase
      .from("order_items")
      .select("*")
      .in("order_id", orderIds);

    if (itemErr) {
      console.error("[OrderStore] DB error fetching order items:", itemErr);
      throw new Error(`Failed to fetch order items from Supabase: ${itemErr.message}`);
    }

    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const itemRow of itemRows || []) {
      const snap = (itemRow.snapshot_json || {}) as Partial<OrderItem>;
      const item: OrderItem = {
        orderItemId: itemRow.id,
        productId: itemRow.product_id || snap.productId || undefined,
        variantId: itemRow.variant_id || snap.variantId || undefined,
        slug: snap.slug || itemRow.sku || "",
        sku: itemRow.sku || snap.sku || undefined,
        size: itemRow.size || snap.size || undefined,
        color: itemRow.color || snap.color || undefined,
        name: itemRow.title || snap.name || "",
        dropName: snap.dropName || "Ascend Drop",
        price: Number(itemRow.unit_price_paise || 0) / 100,
        pricePaise: Number(itemRow.unit_price_paise || 0),
        priceDisplay: snap.priceDisplay || `₹${Number(itemRow.unit_price_paise || 0) / 100}`,
        quantity: itemRow.quantity,
        lineTotal: Number(itemRow.total_price_paise || 0) / 100,
        manufacturingIdentityHash: itemRow.manufacturing_identity_hash || snap.manufacturingIdentityHash || undefined,
        manufacturingSnapshotJson: itemRow.manufacturing_snapshot_json || snap.manufacturingSnapshotJson || undefined,
      };
      const list = itemsByOrder.get(itemRow.order_id) || [];
      list.push(item);
      itemsByOrder.set(itemRow.order_id, list);
    }

    return orderRows.map((row) => {
      const customerObj = (row.shipping_address || {}) as unknown as Order["customer"];
      const paymentMethod: PaymentMethod = row.payment_method === "cod" ? "cod" : "online";
      return {
        id: row.id,
        createdAt: row.created_at,
        status: row.status,
        paymentMethod,
        paymentProvider: row.payment_provider || "razorpay",
        paymentStatus: row.payment_status || "unpaid",
        isCod: paymentMethod === "cod",
        currency: row.currency || "INR",
        subtotal: Number(row.subtotal_paise || row.total_paise || 0) / 100,
        items: itemsByOrder.get(row.id) || [],
        customer: customerObj,
        shippingAddress: customerObj,
        codStatus: row.cod_status || (paymentMethod === "cod" ? "COD_PENDING_CONFIRMATION" : "NOT_COD"),
        advanceRequired: row.advance_required || false,
        advanceAmountPaise: Number(row.advance_amount_paise || 0),
        advancePaymentId: row.advance_payment_id || undefined,
        advanceStatus: row.advance_status || "none",
        codConfirmationTokenHash: row.cod_confirmation_token_hash || undefined,
        customerReadTokenHash: row.customer_read_token_hash || undefined,
      };
    });
  }

  if (isProduction) {
    throw new Error("[OrderStore FATAL] Insecure memory fallback prohibited in production.");
  }

  return Array.from(memoryOrders.values());
}

