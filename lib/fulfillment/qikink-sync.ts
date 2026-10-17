/**
 * Qikink automation:
 *  - autoSubmitOrderToQikink: sends an order the moment it becomes eligible
 *    (prepaid captured, or COD approved). Safe to call repeatedly — eligibility
 *    and the claim RPC guarantee one Qikink order per Ascend order.
 *  - sweepEligibleOrders: safety net for orders whose trigger was missed.
 *  - syncOpenFulfillments: Qikink has no webhooks, so we poll status, AWB and courier.
 */

import { getAllOrdersAdmin } from "@/lib/orders/store";
import { evaluateOrderFulfillmentEligibility } from "./eligibility";
import {
  createOrClaimFulfillmentAdmin,
  getAllFulfillmentsAdmin,
  getFulfillmentByOrderIdAdmin,
  submitFulfillmentToProviderAdmin,
  updateFulfillmentStatusAdmin,
} from "./fulfillment-store";
import { QikinkFulfillmentAdapter } from "./qikink";
import { qikinkAutoSubmitEnabled } from "./qikink-client";
import { ALLOWED_STATUS_TRANSITIONS } from "./status-graph";
import type { FulfillmentStatus } from "./types";

const TERMINAL: FulfillmentStatus[] = ["DELIVERED", "RETURNED", "CANCELLED", "FAILED"];
/** Qikink allows ~30 requests a minute; each lookup can page, so keep runs small. */
const MAX_SYNC_PER_RUN = 12;
const SWEEP_WINDOW_DAYS = 14;

export function isQikinkLive(): boolean {
  return new QikinkFulfillmentAdapter().validateConfiguration().isValid;
}

function autoSubmitEnabled(): boolean {
  return qikinkAutoSubmitEnabled() && isQikinkLive();
}

export type AutoSubmitResult =
  | { submitted: true; providerOrderId?: string }
  | { submitted: false; reason: string };

export async function autoSubmitOrderToQikink(orderId: string): Promise<AutoSubmitResult> {
  try {
    if (!autoSubmitEnabled()) return { submitted: false, reason: "qikink_auto_submit_off" };

    const eligibility = await evaluateOrderFulfillmentEligibility(orderId);
    if (!eligibility.eligible) {
      return { submitted: false, reason: eligibility.blockingReasons.join(", ") };
    }

    const claim = await createOrClaimFulfillmentAdmin(orderId, null);
    if (!claim.ok) return { submitted: false, reason: claim.error };

    const sent = await submitFulfillmentToProviderAdmin(claim.fulfillment.id, null);
    if (!sent.ok) {
      console.error("[qikink:auto-submit] rejected", orderId, sent.error);
      return { submitted: false, reason: sent.error };
    }
    console.info("[qikink:auto-submit] sent", orderId, sent.fulfillment.providerOrderId);
    return { submitted: true, providerOrderId: sent.fulfillment.providerOrderId };
  } catch (err) {
    console.error("[qikink:auto-submit] error", orderId, err);
    return { submitted: false, reason: err instanceof Error ? err.message : "auto_submit_error" };
  }
}

export async function sweepEligibleOrders(): Promise<{ checked: number; submitted: string[]; skipped: number }> {
  if (!autoSubmitEnabled()) return { checked: 0, submitted: [], skipped: 0 };
  const since = Date.now() - SWEEP_WINDOW_DAYS * 86_400_000;
  const orders = (await getAllOrdersAdmin()).filter((o) => new Date(o.createdAt).getTime() >= since);
  const submitted: string[] = [];
  let skipped = 0;
  for (const order of orders) {
    const existing = await getFulfillmentByOrderIdAdmin(order.id);
    if (existing) {
      skipped++;
      continue;
    }
    const res = await autoSubmitOrderToQikink(order.id);
    if (res.submitted) submitted.push(order.id);
    else skipped++;
  }
  return { checked: orders.length, submitted, skipped };
}

/** States that must come from Qikink itself — never invented as a stepping stone. */
const NOT_INTERMEDIATE = new Set<FulfillmentStatus>([
  "EXCEPTION",
  "ACTION_REQUIRED",
  "OUT_OF_STOCK",
  "UNKNOWN_PROVIDER_STATE",
  "FAILED",
  "CANCELLED",
  "QUEUED",
]);

/** Shortest path through the status graph, so a jump (e.g. PROCESSING → DELIVERED) is recorded step by step. */
export function statusPath(from: FulfillmentStatus, to: FulfillmentStatus): FulfillmentStatus[] | null {
  if (from === to) return [];
  const queue: FulfillmentStatus[][] = [[from]];
  const seen = new Set<FulfillmentStatus>([from]);
  while (queue.length) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    for (const next of ALLOWED_STATUS_TRANSITIONS[last] ?? []) {
      if (seen.has(next)) continue;
      const nextPath = [...path, next];
      if (next === to) return nextPath.slice(1);
      if (NOT_INTERMEDIATE.has(next)) continue;
      seen.add(next);
      queue.push(nextPath);
    }
  }
  return null;
}

export type SyncRow = { fulfillmentId: string; orderId: string; from: FulfillmentStatus; to?: FulfillmentStatus; note?: string };

export async function syncOpenFulfillments(limit = MAX_SYNC_PER_RUN): Promise<SyncRow[]> {
  const adapter = new QikinkFulfillmentAdapter();
  if (!adapter.validateConfiguration().isValid) return [];

  const open = (await getAllFulfillmentsAdmin())
    .filter((f) => !TERMINAL.includes(f.status))
    .filter((f) => f.providerOrderId || f.status === "RECONCILIATION_REQUIRED")
    .sort((a, b) => new Date(a.lastSyncedAt || a.updatedAt).getTime() - new Date(b.lastSyncedAt || b.updatedAt).getTime())
    .slice(0, limit);

  const rows: SyncRow[] = [];
  for (const f of open) {
    try {
      const lookup = await adapter.getOrder(f.providerOrderId || "", f.providerReference);
      if (!lookup.found || !lookup.normalizedStatus) {
        rows.push({ fulfillmentId: f.id, orderId: f.orderId, from: f.status, note: "not_found_on_qikink" });
        continue;
      }
      const target = lookup.normalizedStatus;
      const path = statusPath(f.status, target);
      if (path === null) {
        rows.push({ fulfillmentId: f.id, orderId: f.orderId, from: f.status, to: target, note: "no_valid_transition" });
        continue;
      }
      const steps = path.length ? path : [f.status];
      for (const step of steps) {
        const res = await updateFulfillmentStatusAdmin(
          f.id,
          step,
          lookup.providerStatus,
          undefined,
          undefined,
          lookup.awb || f.trackingNumber,
          lookup.courier || f.courierName,
          null,
        );
        if (!res.ok) {
          rows.push({ fulfillmentId: f.id, orderId: f.orderId, from: f.status, to: step, note: res.error });
          break;
        }
      }
      rows.push({ fulfillmentId: f.id, orderId: f.orderId, from: f.status, to: target });
    } catch (err) {
      rows.push({
        fulfillmentId: f.id,
        orderId: f.orderId,
        from: f.status,
        note: err instanceof Error ? err.message : "sync_error",
      });
    }
  }
  return rows;
}
