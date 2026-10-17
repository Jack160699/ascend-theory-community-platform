/**
 * Ascend HQ — real store metrics, computed on the server from Supabase.
 * Every number on the dashboard comes from here; nothing is estimated or seeded.
 * Each source is loaded independently so one failure shows as "unavailable"
 * instead of taking the whole dashboard down.
 */

import { getAllOrdersAdmin } from "@/lib/orders/store";
import type { Order } from "@/lib/orders/types";
import { getAllFulfillmentsAdmin, type FulfillmentRecord } from "@/lib/fulfillment/fulfillment-store";
import type { FulfillmentStatus } from "@/lib/fulfillment/types";
import { getAllProductsAdmin } from "@/lib/wearables/store";
import type { Product } from "@/lib/wearables/types";
import { getAllProviderMappingsAdmin } from "@/lib/wearables/design-store";
import {
  getQikinkConfig,
  qikinkAutoSubmitEnabled,
  qikinkEnv,
  qikinkSendingEnabled,
} from "@/lib/fulfillment/qikink-client";

export const LOW_STOCK_THRESHOLD = 5;

const IN_PRODUCTION: FulfillmentStatus[] = ["SUBMITTING", "SUBMITTED", "PROCESSING", "PRINTED", "MANIFESTED"];
const NEEDS_ATTENTION: FulfillmentStatus[] = [
  "FAILED",
  "ACTION_REQUIRED",
  "RECONCILIATION_REQUIRED",
  "OUT_OF_STOCK",
  "EXCEPTION",
  "UNKNOWN_PROVIDER_STATE",
  "RTO_INITIATED",
  "RETURNED",
];

export type OrderStage =
  | "awaiting_payment"
  | "cod_review"
  | "ready_to_send"
  | "in_production"
  | "shipped"
  | "delivered"
  | "needs_attention"
  | "cancelled";

export const ORDER_STAGE_LABEL: Record<OrderStage, string> = {
  awaiting_payment: "Awaiting payment",
  cod_review: "COD review",
  ready_to_send: "Ready to send",
  in_production: "At Qikink",
  shipped: "Shipped",
  delivered: "Delivered",
  needs_attention: "Needs attention",
  cancelled: "Cancelled",
};

export type MoneyByCurrency = Record<string, number>;

export type OrderRow = {
  id: string;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shipTo: string;
  items: { name: string; size?: string; color?: string; quantity: number; lineTotal: number }[];
  units: number;
  total: number;
  currency: string;
  paymentLabel: string;
  isCod: boolean;
  stage: OrderStage;
  fulfilmentStatus?: FulfillmentStatus;
  providerOrderId?: string;
  trackingNumber?: string;
  courierName?: string;
  failureMessage?: string;
};

export type StockAlert = { product: string; size: string; color: string; stock: number; sku: string };

export type HqMetrics = {
  generatedAt: string;
  errors: string[];
  revenue: { allTime: MoneyByCurrency; thisMonth: MoneyByCurrency; paidOrders: number; unitsSold: number } | null;
  stages: Record<OrderStage, number> | null;
  totalOrders: number | null;
  recentOrders: OrderRow[];
  catalogue: {
    activeProducts: number;
    draftProducts: number;
    sellableVariants: number;
    outOfStock: number;
    lowStock: number;
    alerts: StockAlert[];
  } | null;
  qikink: {
    credentialsSet: boolean;
    environment: "sandbox" | "live";
    sendingEnabled: boolean;
    autoSubmit: boolean;
    linkedVariants: number | null;
    sellableVariants: number | null;
  };
};

async function safe<T>(label: string, errors: string[], load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    console.error(`[hq-metrics] ${label} failed`, err);
    errors.push(label);
    return null;
  }
}

function isPaid(order: Order, fulfilment?: FulfillmentRecord): boolean {
  if (order.status === "cancelled" || order.status === "refunded" || order.paymentStatus === "refunded") return false;
  if (order.paymentStatus === "captured") return true;
  // Cash on delivery is only money once the parcel is delivered.
  return Boolean(order.isCod && fulfilment?.status === "DELIVERED");
}

export function orderStage(order: Order, fulfilment?: FulfillmentRecord): OrderStage {
  if (order.status === "cancelled" || order.status === "refunded" || order.paymentStatus === "refunded") {
    return "cancelled";
  }
  if (fulfilment) {
    const s = fulfilment.status;
    if (s === "DELIVERED") return "delivered";
    if (s === "IN_TRANSIT") return "shipped";
    if (IN_PRODUCTION.includes(s)) return "in_production";
    if (NEEDS_ATTENTION.includes(s)) return "needs_attention";
    if (s === "CANCELLED") return "cancelled";
    return "ready_to_send"; // READY / QUEUED
  }
  if (order.isCod) {
    if (order.codStatus === "COD_APPROVED") return "ready_to_send";
    if (order.codStatus === "COD_REJECTED" || order.codStatus === "COD_EXPIRED") return "cancelled";
    return "cod_review";
  }
  return order.paymentStatus === "captured" ? "ready_to_send" : "awaiting_payment";
}

function add(target: MoneyByCurrency, currency: string, amount: number) {
  const key = (currency || "INR").toUpperCase();
  target[key] = Math.round(((target[key] ?? 0) + amount) * 100) / 100;
}

function paymentLabel(order: Order): string {
  if (order.isCod) return "Cash on delivery";
  switch (order.paymentStatus) {
    case "captured":
      return "Paid";
    case "authorized":
      return "Authorised";
    case "failed":
      return "Payment failed";
    case "refunded":
      return "Refunded";
    default:
      return "Unpaid";
  }
}

export function toOrderRow(order: Order, fulfilment?: FulfillmentRecord): OrderRow {
  const ship = order.shippingAddress ?? order.customer;
  return {
    id: order.id,
    createdAt: order.createdAt,
    customerName: order.customer?.fullName || "—",
    customerEmail: order.customer?.email || "",
    customerPhone: order.customer?.phone || "",
    shipTo: [ship?.addressLine1 || ship?.address, ship?.addressLine2, ship?.city, ship?.state, ship?.postalCode, ship?.country]
      .filter(Boolean)
      .join(", "),
    items: (order.items || []).map((i) => ({
      name: i.name,
      size: i.size,
      color: i.color,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    units: (order.items || []).reduce((n, i) => n + (i.quantity || 0), 0),
    total: order.subtotal,
    currency: (order.currency || "INR").toUpperCase(),
    paymentLabel: paymentLabel(order),
    isCod: Boolean(order.isCod),
    stage: orderStage(order, fulfilment),
    fulfilmentStatus: fulfilment?.status,
    providerOrderId: fulfilment?.providerOrderId,
    trackingNumber: fulfilment?.trackingNumber,
    courierName: fulfilment?.courierName,
    failureMessage: fulfilment?.failureMessage,
  };
}

/** Orders joined with their fulfilment record, newest first. */
export async function getOrderRows(): Promise<OrderRow[]> {
  const [orders, fulfilments] = await Promise.all([getAllOrdersAdmin(), getAllFulfillmentsAdmin()]);
  const byOrder = new Map(fulfilments.map((f) => [f.orderId, f]));
  return orders
    .map((o) => toOrderRow(o, byOrder.get(o.id)))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function catalogueMetrics(products: Product[]) {
  const active = products.filter((p) => p.status === "active");
  const alerts: StockAlert[] = [];
  let sellable = 0;
  let out = 0;
  let low = 0;
  for (const p of active) {
    for (const v of p.variants ?? []) {
      if (!v.isActive || v.availabilityStatus !== "available") continue;
      sellable++;
      if (v.stockQuantity <= 0) out++;
      else if (v.stockQuantity <= LOW_STOCK_THRESHOLD) low++;
      if (v.stockQuantity <= LOW_STOCK_THRESHOLD) {
        alerts.push({ product: p.title, size: v.size, color: v.colorDisplay || v.color, stock: v.stockQuantity, sku: v.sku });
      }
    }
  }
  alerts.sort((a, b) => a.stock - b.stock);
  return {
    activeProducts: active.length,
    draftProducts: products.filter((p) => p.status === "draft").length,
    sellableVariants: sellable,
    outOfStock: out,
    lowStock: low,
    alerts: alerts.slice(0, 8),
    sellableIds: new Set(active.flatMap((p) => (p.variants ?? []).filter((v) => v.isActive).map((v) => v.id))),
  };
}

export async function getHqMetrics(): Promise<HqMetrics> {
  const errors: string[] = [];
  const [orders, fulfilments, products, mappings] = await Promise.all([
    safe("Orders", errors, getAllOrdersAdmin),
    safe("Fulfilment", errors, getAllFulfillmentsAdmin),
    safe("Products", errors, getAllProductsAdmin),
    safe("Qikink SKU links", errors, getAllProviderMappingsAdmin),
  ]);

  const byOrder = new Map((fulfilments ?? []).map((f) => [f.orderId, f]));
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  let revenue: HqMetrics["revenue"] = null;
  let stages: HqMetrics["stages"] = null;
  let recentOrders: OrderRow[] = [];

  if (orders) {
    revenue = { allTime: {}, thisMonth: {}, paidOrders: 0, unitsSold: 0 };
    stages = {
      awaiting_payment: 0,
      cod_review: 0,
      ready_to_send: 0,
      in_production: 0,
      shipped: 0,
      delivered: 0,
      needs_attention: 0,
      cancelled: 0,
    };
    for (const order of orders) {
      const f = byOrder.get(order.id);
      stages[orderStage(order, f)]++;
      if (isPaid(order, f)) {
        revenue.paidOrders++;
        revenue.unitsSold += (order.items || []).reduce((n, i) => n + (i.quantity || 0), 0);
        add(revenue.allTime, order.currency, order.subtotal);
        if (new Date(order.createdAt) >= monthStart) add(revenue.thisMonth, order.currency, order.subtotal);
      }
    }
    recentOrders = orders
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8)
      .map((o) => toOrderRow(o, byOrder.get(o.id)));
  }

  const cat = products ? catalogueMetrics(products) : null;
  const linkedVariants =
    mappings && cat
      ? new Set(
          mappings.providerVariants
            .filter((v) => v.mappingStatus === "verified" && v.productVariantId && cat.sellableIds.has(v.productVariantId))
            .map((v) => v.productVariantId),
        ).size
      : null;

  return {
    generatedAt: new Date().toISOString(),
    errors,
    revenue,
    stages,
    totalOrders: orders ? orders.length : null,
    recentOrders,
    catalogue: cat
      ? {
          activeProducts: cat.activeProducts,
          draftProducts: cat.draftProducts,
          sellableVariants: cat.sellableVariants,
          outOfStock: cat.outOfStock,
          lowStock: cat.lowStock,
          alerts: cat.alerts,
        }
      : null,
    qikink: {
      credentialsSet: Boolean(getQikinkConfig()),
      environment: qikinkEnv(),
      sendingEnabled: qikinkSendingEnabled(),
      autoSubmit: qikinkAutoSubmitEnabled(),
      linkedVariants,
      sellableVariants: cat ? cat.sellableIds.size : null,
    },
  };
}
