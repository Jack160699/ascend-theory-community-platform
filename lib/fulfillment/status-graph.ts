/**
 * Phase 6 — Authoritative Fulfillment Status Transition Graph
 * Defines strict conservative state transitions for POD manufacturing lifecycle.
 */

import type { FulfillmentStatus } from "./types";

export const ALLOWED_STATUS_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  READY: ["SUBMITTING", "CANCELLED"],
  QUEUED: ["SUBMITTING", "CANCELLED"],
  SUBMITTING: [
    "SUBMITTED",
    "PROCESSING",
    "QUEUED",
    "FAILED",
    "RECONCILIATION_REQUIRED",
    "ACTION_REQUIRED",
    "OUT_OF_STOCK",
    "UNKNOWN_PROVIDER_STATE",
  ],
  SUBMITTED: [
    "PROCESSING",
    "MANIFESTED",
    "IN_TRANSIT",
    "ACTION_REQUIRED",
    "OUT_OF_STOCK",
    "EXCEPTION",
    "UNKNOWN_PROVIDER_STATE",
  ],
  PROCESSING: [
    "PRINTED",
    "MANIFESTED",
    "IN_TRANSIT",
    "ACTION_REQUIRED",
    "OUT_OF_STOCK",
    "EXCEPTION",
    "FAILED",
    "UNKNOWN_PROVIDER_STATE",
  ],
  PRINTED: ["MANIFESTED", "IN_TRANSIT", "EXCEPTION"],
  MANIFESTED: ["IN_TRANSIT", "EXCEPTION"],
  IN_TRANSIT: ["DELIVERED", "RTO_INITIATED", "EXCEPTION"],
  RTO_INITIATED: ["RETURNED"],
  ACTION_REQUIRED: ["PROCESSING", "FAILED", "CANCELLED", "UNKNOWN_PROVIDER_STATE"],
  OUT_OF_STOCK: ["PROCESSING", "FAILED", "CANCELLED"],
  UNKNOWN_PROVIDER_STATE: [
    "PROCESSING",
    "ACTION_REQUIRED",
    "OUT_OF_STOCK",
    "MANIFESTED",
    "IN_TRANSIT",
    "DELIVERED",
    "FAILED",
    "CANCELLED",
  ],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
  FAILED: [],
  RECONCILIATION_REQUIRED: ["PROCESSING", "SUBMITTED", "ACTION_REQUIRED", "OUT_OF_STOCK", "FAILED", "CANCELLED", "UNKNOWN_PROVIDER_STATE"],
  EXCEPTION: ["IN_TRANSIT", "DELIVERED", "RTO_INITIATED", "RETURNED", "CANCELLED", "FAILED"],
};

export function isValidStatusTransition(current: FulfillmentStatus, next: FulfillmentStatus): boolean {
  if (current === next) return true;
  const allowed = ALLOWED_STATUS_TRANSITIONS[current];
  if (!allowed) return false;
  return allowed.includes(next);
}
