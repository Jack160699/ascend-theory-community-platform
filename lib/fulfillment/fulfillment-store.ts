/**
 * Phase 6 — Authoritative Server-Side POD Fulfilment Store
 * Manages immutable fulfillment snapshots, atomic claim-before-submit flows,
 * provider order binding, ambiguous network failure reconciliation, bounded retries,
 * secret redaction, and operational RBAC mutations.
 */

import crypto from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import type {
  FulfillmentStatus,
  FulfillmentSnapshot,
  FulfillmentItemSnapshot,
  PODFulfillmentProvider,
  ActivePlacementSnapshot,
  ProviderOrderSubmissionResult,
  FulfillmentSupportDTO,
} from "./types";
import { evaluateOrderFulfillmentEligibility } from "./eligibility";
import { redactSecrets } from "./qikink";
import { getFulfillmentProviderAdapter } from "./provider-registry";
import { getAllDesignsAdmin, getAllProviderMappingsAdmin } from "@/lib/wearables/design-store";
import { computeManufacturingIntentHash } from "./hash";
import { validateFulfillmentSnapshotBeforeFirstSubmission } from "./snapshot-validator";
import { isValidStatusTransition } from "./status-graph";

/**
 * Converts a full FulfillmentRecord to a Support-Safe DTO (Requirement #6).
 * Strips snapshots, request hashes, artwork paths, and payment internals.
 */
export function toSupportDTO(rec: FulfillmentRecord): FulfillmentSupportDTO {
  return {
    id: rec.id,
    orderId: rec.orderId,
    status: rec.status,
    providerStatus: rec.providerStatus,
    trackingNumber: rec.trackingNumber,
    courierName: rec.courierName,
    failureMessage: rec.failureMessage,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

export type FulfillmentRecord = {
  id: string;
  orderId: string;
  providerId?: string;
  providerOrderId?: string;
  providerReference?: string;
  idempotencyKey?: string;
  requestHash?: string;
  status: FulfillmentStatus;
  providerStatus?: string;
  attemptCount: number;
  retryable?: boolean;
  maxAttempts?: number;
  nextRetryAt?: string;
  submittedAt?: string;
  lastSyncedAt?: string;
  failedAt?: string;
  failureCode?: string;
  failureMessage?: string;
  trackingNumber?: string;
  courierName?: string;
  metadataJson?: Record<string, unknown>;
  snapshotJson?: FulfillmentSnapshot;
  createdAt: string;
  updatedAt: string;
};

// In-memory fallback store for development & testing
const memoryFulfillments = new Map<string, FulfillmentRecord>();

function isUUID(val?: string | null): boolean {
  if (!val) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

function mapRowToFulfillmentRecord(row: Record<string, unknown>): FulfillmentRecord {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    providerId: (row.provider_id as string) || undefined,
    providerOrderId: (row.provider_order_id as string) || undefined,
    providerReference: (row.provider_reference as string) || undefined,
    idempotencyKey: (row.idempotency_key as string) || undefined,
    requestHash: (row.request_hash as string) || undefined,
    status: (row.status as FulfillmentStatus) || "READY",
    providerStatus: (row.provider_status as string) || undefined,
    attemptCount: Number(row.attempt_count || 0),
    retryable: row.retryable !== undefined ? Boolean(row.retryable) : true,
    maxAttempts: Number(row.max_attempts || 3),
    nextRetryAt: (row.next_retry_at as string) || undefined,
    submittedAt: (row.submitted_at as string) || undefined,
    lastSyncedAt: (row.last_synced_at as string) || undefined,
    failedAt: (row.failed_at as string) || undefined,
    failureCode: (row.failure_code as string) || undefined,
    failureMessage: (row.failure_message as string) || undefined,
    trackingNumber: (row.tracking_number as string) || (row.awb as string) || undefined,
    courierName: (row.courier_name as string) || (row.courier as string) || undefined,
    metadataJson: (row.metadata_json as Record<string, unknown>) || {},
    snapshotJson: (row.snapshot_json as FulfillmentSnapshot) || undefined,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

/**
 * Calculates exponential backoff with bounded jitter (30s, 2m, 8m).
 */
function computeNextRetryAt(attemptCount: number): { nextRetryAt: string; delaySec: number } {
  const delays = [30, 120, 480];
  const idx = Math.min(attemptCount, delays.length - 1);
  const baseDelay = delays[idx]!;
  const jitter = Math.floor(Math.random() * 5); // 0-4s jitter
  const totalSec = baseDelay + jitter;
  const nextDate = new Date(Date.now() + totalSec * 1000);
  return { nextRetryAt: nextDate.toISOString(), delaySec: totalSec };
}

/**
 * Fail-closed DB reader for all fulfillments.
 */
export async function getAllFulfillmentsAdmin(): Promise<FulfillmentRecord[]> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      throw new Error("[FulfillmentStore] Supabase service role client unavailable");
    }
    const { data, error } = await serviceClient
      .from("fulfillments")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`[FulfillmentStore] Database error fetching fulfillments: ${error.message}`);
    }
    return (data || []).map(mapRowToFulfillmentRecord);
  }

  return Array.from(memoryFulfillments.values());
}

/**
 * Direct DB query lookup by fulfillment ID. (Requirement #23)
 */
export async function getFulfillmentByIdAdmin(id: string): Promise<FulfillmentRecord | null> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      throw new Error("[FulfillmentStore] Supabase service role client unavailable");
    }
    const { data, error } = await serviceClient
      .from("fulfillments")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`[FulfillmentStore] Database error fetching fulfillment ${id}: ${error.message}`);
    }
    return data ? mapRowToFulfillmentRecord(data) : null;
  }

  return memoryFulfillments.get(id) || null;
}

/**
 * Direct DB query lookup for active fulfillment by order ID. (Requirement #23)
 */
export async function getFulfillmentByOrderIdAdmin(orderId: string): Promise<FulfillmentRecord | null> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      throw new Error("[FulfillmentStore] Supabase service role client unavailable");
    }
    const { data, error } = await serviceClient
      .from("fulfillments")
      .select("*")
      .eq("order_id", orderId)
      .not("status", "in", '("FAILED","CANCELLED")')
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`[FulfillmentStore] Database error fetching active fulfillment for order ${orderId}: ${error.message}`);
    }
    return data ? mapRowToFulfillmentRecord(data) : null;
  }

  return (
    Array.from(memoryFulfillments.values()).find(
      (f) => f.orderId === orderId && !["FAILED", "CANCELLED"].includes(f.status),
    ) || null
  );
}

/**
 * Creates or claims initial fulfillment lock.
 * Assembles multi-item snapshot from real Phase 5 designs and placements (Requirement #6 & #7).
 * Computes deterministic request_hash (Requirement #11).
 * Uses exact pre-generated UUID for fulfillment ID (Requirement #10).
 */
export async function createOrClaimFulfillmentAdmin(
  orderId: string,
  adminId?: string | null,
): Promise<{ ok: true; fulfillment: FulfillmentRecord } | { ok: false; error: string; fulfillmentId?: string }> {
  // 1. Evaluate server-side fulfillment eligibility
  const existingActive = await getFulfillmentByOrderIdAdmin(orderId);
  const eligibility = await evaluateOrderFulfillmentEligibility(orderId, existingActive?.id);
  if (!eligibility.eligible) {
    return {
      ok: false,
      error: `Order fulfillment ineligible: ${eligibility.blockingReasons.join(", ")}`,
    };
  }

  const order = eligibility.order!;
  const provider = eligibility.provider!;

  const fulfillmentId = crypto.randomUUID(); // Pre-generated exact UUID
  const idempotencyKey = `idemp-${order.id}-${provider.id}`;
  const providerRef = `ASCEND-ORD-${order.id}`;

  const dbAdminId = isUUID(adminId) ? adminId : null; // System actor uses null UUID

  // Load real Phase 5 entities for snapshot assembly
  const mappings = await getAllProviderMappingsAdmin();
  const designs = await getAllDesignsAdmin();
  const designsMap = new Map(designs.map((d) => [d.id, d]));
  const placementsList = designs.flatMap((d) => d.placements || []);

  const itemsSnapshots: FulfillmentItemSnapshot[] = [];

  for (const item of order.items || []) {
    // Requirement #4: Every order item MUST have a real orderItemId
    if (!item.orderItemId) {
      return { ok: false, error: "missing_order_item_id" };
    }

    const pProd = mappings.providerProducts.find(
      (pp) => pp.productId === item.productId && pp.providerId === provider.id && pp.mappingStatus === "verified",
    );
    const pVar = mappings.providerVariants.find(
      (pv) => pv.productVariantId === item.variantId && pv.providerProductId === pProd?.id && pv.mappingStatus === "verified",
    );

    if (!pProd || !pVar) {
      return { ok: false, error: `Missing verified provider mapping for item ${item.sku || item.slug}` };
    }

    // Load actual active design_placements for this variant
    const variantPlacements = placementsList.filter((p) => p.productVariantId === item.variantId && p.isActive);

    const activePlacementSnapshots: ActivePlacementSnapshot[] = variantPlacements.map((pl) => {
      const design = designsMap.get(pl.designId);
      return {
        placementId: pl.id,
        designId: pl.designId,
        designVersion: design?.version ?? 1, // Requirement #5: designVersion in snapshot
        designSlug: design?.slug || "",
        designTitle: design?.title || "Design Artwork",
        storagePath: design?.storagePath || "",
        checksum: design?.checksum,
        placementLocation: pl.placementLocation,
        xNormalized: pl.xNormalized,
        yNormalized: pl.yNormalized,
        scale: pl.scale,
        rotationDeg: pl.rotationDeg,
        widthMm: pl.widthMm,
        heightMm: pl.heightMm,
        printMethod: pl.printMethod,
      };
    });

    itemsSnapshots.push({
      orderItemId: item.orderItemId,
      productId: item.productId || "",
      variantId: item.variantId || "",
      ascendSku: item.sku || item.slug || "",
      quantity: item.quantity,

      providerProductMappingId: pProd.id,
      providerExternalProductId: pProd.externalProductId,
      providerVariantMappingId: pVar.id,
      providerExternalVariantId: pVar.externalVariantId,
      providerExternalSku: pVar.externalSku || pVar.sku || "",

      placements: activePlacementSnapshots,
    });
  }

  const customerAddr = order.shippingAddress || order.customer;
  const isCod = Boolean(order.isCod || order.paymentMethod === "cod");

  const unhashedSnapshot: Omit<FulfillmentSnapshot, "requestHash"> = {
    fulfillmentId,
    orderId: order.id,
    orderNumber: order.id,
    items: itemsSnapshots,

    providerId: provider.id,
    providerSlug: provider.slug,

    customerShipping: {
      fullName: customerAddr.fullName,
      email: customerAddr.email || "customer@example.com",
      phone: customerAddr.phone || "",
      addressLine1: customerAddr.addressLine1 || customerAddr.address || "",
      addressLine2: customerAddr.addressLine2,
      city: customerAddr.city,
      state: customerAddr.state || "",
      postalCode: customerAddr.postalCode,
      country: customerAddr.country || "IN",
    },

    isCod,
    paymentMode: isCod ? "cod" : "online",
    currency: order.currency || "INR",
    createdAt: new Date().toISOString(),
  };

  // Requirement #2: Recursive stable canonicalizer & SHA-256 manufacturing intent hash
  const requestHash = computeManufacturingIntentHash(unhashedSnapshot as FulfillmentSnapshot);

  const snapshot: FulfillmentSnapshot = redactSecrets({
    ...unhashedSnapshot,
    requestHash,
  });

  // FAIL-CLOSED SUPABASE DB RPC CLAIM
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      return { ok: false, error: "Server configuration error: Supabase service client unavailable" };
    }

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("create_or_claim_fulfillment_with_audit", {
      p_fulfillment_id: fulfillmentId,
      p_order_id: orderId,
      p_provider_id: provider.id,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
      p_provider_reference: providerRef,
      p_snapshot_json: snapshot,
      p_admin_id: dbAdminId,
    });

    if (rpcErr) {
      return { ok: false, error: `RPC execution failed: ${rpcErr.message}` };
    }
    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      const errStr = (rpcData as { error?: string })?.error || "Fulfillment claim failed";
      return { ok: false, error: errStr, fulfillmentId: (rpcData as { fulfillment_id?: string })?.fulfillment_id };
    }

    const claimedId = (rpcData as { fulfillment_id: string }).fulfillment_id;
    const fulfillment = await getFulfillmentByIdAdmin(claimedId);
    return { ok: true, fulfillment: fulfillment || (memoryFulfillments.get(claimedId)!) };
  }

  // LOCAL MEMORY FALLBACK WITH EXACTLY-ONCE & REQUEST HASH GUARD (Requirement #3, #4)
  const existing = Array.from(memoryFulfillments.values()).find(
    (f) => f.idempotencyKey === idempotencyKey || (f.orderId === orderId && f.providerId === provider.id && !["CANCELLED"].includes(f.status)),
  );

  if (existing) {
    if (existing.status === "FAILED" && !existing.providerOrderId) {
      return { ok: false, error: "failed_fulfillment_requires_manual_review", fulfillmentId: existing.id };
    }
    if (existing.requestHash && existing.requestHash !== requestHash) {
      return { ok: false, error: "idempotency_payload_mismatch", fulfillmentId: existing.id };
    }
    if (["SUBMITTING"].includes(existing.status)) {
      return { ok: false, error: "already_claimed", fulfillmentId: existing.id };
    }
    if (["SUBMITTED", "PROCESSING", "MANIFESTED", "IN_TRANSIT", "DELIVERED"].includes(existing.status) || existing.providerOrderId) {
      return { ok: false, error: "already_submitted", fulfillmentId: existing.id };
    }
  }

  const record: FulfillmentRecord = {
    id: fulfillmentId,
    orderId,
    providerId: provider.id,
    providerReference: providerRef,
    idempotencyKey,
    requestHash,
    status: "SUBMITTING",
    attemptCount: 1,
    retryable: true,
    maxAttempts: 3,
    snapshotJson: snapshot,
    metadataJson: redactSecrets({ claimedBy: adminId }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  memoryFulfillments.set(fulfillmentId, record);
  return { ok: true, fulfillment: record };
}

/**
 * Submits an initial claimed fulfillment lock to the provider adapter.
 * Enforces server-side guards: provider_order_id must be NULL, status must be SUBMITTING. (Requirement #15)
 * Enforces exact snapshot staleness validator. (Requirement #6)
 * Handles ambiguous network timeouts with reconciliation lookup. (Requirement #11 & #17)
 */
export async function submitFulfillmentToProviderAdmin(
  fulfillmentId: string,
  adminId?: string | null,
  customAdapter?: PODFulfillmentProvider,
): Promise<{ ok: true; fulfillment: FulfillmentRecord } | { ok: false; error: string; fulfillment?: FulfillmentRecord }> {
  const fulfillment = await getFulfillmentByIdAdmin(fulfillmentId);
  if (!fulfillment) {
    return { ok: false, error: "Fulfillment record not found" };
  }

  // Requirement #15: Never resubmit an already-bound or non-SUBMITTING fulfillment
  if (fulfillment.providerOrderId) {
    return { ok: false, error: "already_submitted", fulfillment };
  }

  if (fulfillment.status === "RECONCILIATION_REQUIRED") {
    return { ok: false, error: "reconciliation_required", fulfillment };
  }

  if (fulfillment.status !== "SUBMITTING") {
    return { ok: false, error: `invalid_submission_state: Cannot submit from status ${fulfillment.status}`, fulfillment };
  }

  if (!fulfillment.snapshotJson) {
    return { ok: false, error: "Fulfillment snapshot missing", fulfillment };
  }

  const snapshot = fulfillment.snapshotJson;

  // Requirement #6: Exact Snapshot Staleness Validator
  const snapshotValidation = await validateFulfillmentSnapshotBeforeFirstSubmission(snapshot);
  if (!snapshotValidation.valid) {
    return {
      ok: false,
      error: snapshotValidation.reason,
      fulfillment,
    };
  }

  // Requirement #9: Adapter mismatch protection
  let adapter: PODFulfillmentProvider;
  try {
    adapter = customAdapter || getFulfillmentProviderAdapter(snapshot.providerSlug);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "provider_adapter_mismatch", fulfillment };
  }

  if (snapshot.providerSlug !== adapter.providerSlug) {
    return { ok: false, error: "provider_adapter_mismatch", fulfillment };
  }

  const dbAdminId = isUUID(adminId) ? adminId : null;

  let submissionResult: ProviderOrderSubmissionResult;
  try {
    submissionResult = await adapter.submitOrder(snapshot);
  } catch (err) {
    // Requirement #11 & #17: Ambiguous network failure handling -> RECONCILIATION_REQUIRED
    const errMessage = err instanceof Error ? err.message : "Ambiguous network failure during submission";

    const transitionResult = await updateFulfillmentStatusAdmin(
      fulfillmentId,
      "RECONCILIATION_REQUIRED",
      "AMBIGUOUS_NETWORK_TIMEOUT",
      "NETWORK_TIMEOUT",
      errMessage,
      undefined,
      undefined,
      adminId,
    );

    if (!transitionResult.ok) {
      return {
        ok: false,
        error: `ambiguous_submission_state_persist_failed: ${transitionResult.error}`,
        fulfillment: (await getFulfillmentByIdAdmin(fulfillmentId)) || undefined,
      };
    }

    // If verified lookup is supported by provider adapter, attempt merchant ref lookup
    if (adapter.capabilities.orderLookup) {
      try {
        const lookup = await adapter.getOrder("", fulfillment.providerReference);
        if (lookup.found && lookup.providerOrderId) {
          const bindRes = await bindProviderOrderAdmin(
            fulfillmentId,
            lookup.providerOrderId,
            lookup.providerStatus || "PRINTING",
            lookup.normalizedStatus || "PROCESSING",
            redactSecrets(lookup.rawResponse || {}),
            adminId,
          );
          if (!bindRes.ok) {
            return {
              ok: false,
              error: `provider_order_bind_failed: ${bindRes.error}`,
              fulfillment: (await getFulfillmentByIdAdmin(fulfillmentId)) || undefined,
            };
          }
          const bound = await getFulfillmentByIdAdmin(fulfillmentId);
          return { ok: true, fulfillment: bound! };
        }
      } catch {
        // Lookup error
      }
    }

    return {
      ok: false,
      error: `Ambiguous network failure: ${errMessage}. Order placed into RECONCILIATION_REQUIRED status.`,
      fulfillment: (await getFulfillmentByIdAdmin(fulfillmentId)) || undefined,
    };
  }

  if (!submissionResult.success || !submissionResult.providerOrderId) {
    // Requirement #9 & #10: Atomic failure recording via RPC
    const isTransient = ["429_RATE_LIMIT", "500_SERVER_ERROR"].includes(submissionResult.errorCode || "");
    const attemptCount = fulfillment.attemptCount || 1;
    const maxAttempts = fulfillment.maxAttempts || 3;
    const isExhausted = attemptCount >= maxAttempts;

    const nextStatus: FulfillmentStatus = isTransient && !isExhausted ? "QUEUED" : "FAILED";
    const retryable = isTransient && !isExhausted;

    const { nextRetryAt } = computeNextRetryAt(attemptCount);

    if (hasSupabaseConfig()) {
      const serviceClient = createSupabaseServiceClient();
      if (serviceClient) {
        const { data: rpcData, error: rpcErr } = await serviceClient.rpc(
          "record_fulfillment_submission_failure_with_audit",
          {
            p_fulfillment_id: fulfillmentId,
            p_next_status: nextStatus,
            p_provider_status: submissionResult.providerStatus || "FAILED",
            p_failure_code: submissionResult.errorCode || "SUBMISSION_FAILED",
            p_failure_message: submissionResult.errorMessage || "Provider order submission failed",
            p_retryable: retryable,
            p_next_retry_at: retryable ? nextRetryAt : null,
            p_admin_id: dbAdminId,
          },
        );

        if (rpcErr || !rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
          return {
            ok: false,
            error: rpcErr?.message || (rpcData as { error?: string })?.error || "Failed to record submission failure",
            fulfillment,
          };
        }
      }
    } else {
      const rec = memoryFulfillments.get(fulfillmentId);
      if (rec) {
        if (!isValidStatusTransition(rec.status, nextStatus)) {
          return { ok: false, error: `invalid_status_transition: cannot move from ${rec.status} to ${nextStatus}`, fulfillment: rec };
        }
        rec.status = nextStatus;
        rec.providerStatus = submissionResult.providerStatus || "FAILED";
        rec.failureCode = submissionResult.errorCode || "SUBMISSION_FAILED";
        rec.failureMessage = submissionResult.errorMessage || "Provider order submission failed";
        rec.retryable = retryable;
        rec.nextRetryAt = retryable ? nextRetryAt : undefined;
        if (nextStatus === "FAILED") rec.failedAt = rec.failedAt || new Date().toISOString();
        rec.updatedAt = new Date().toISOString();
      }
    }

    return {
      ok: false,
      error: submissionResult.errorMessage || "Provider order submission rejected",
      fulfillment: (await getFulfillmentByIdAdmin(fulfillmentId)) || undefined,
    };
  }

  // Successful submission -> bind provider order atomically (Requirement #26)
  const bindRes = await bindProviderOrderAdmin(
    fulfillmentId,
    submissionResult.providerOrderId,
    submissionResult.providerStatus || "PRINTING",
    submissionResult.normalizedStatus || "PROCESSING",
    redactSecrets(submissionResult.rawResponse || {}),
    adminId,
  );

  if (!bindRes.ok) {
    return { ok: false, error: `provider_order_bind_failed: ${bindRes.error}`, fulfillment: (await getFulfillmentByIdAdmin(fulfillmentId)) || undefined };
  }

  const updated = await getFulfillmentByIdAdmin(fulfillmentId);
  return { ok: true, fulfillment: updated! };
}

/**
 * Retries a QUEUED fulfillment attempt using the atomic claim_fulfillment_retry_with_audit RPC.
 * Enforces status MUST be strictly QUEUED. (Requirement #1)
 */
export async function retryFulfillmentSubmissionAdmin(
  fulfillmentId: string,
  adminId?: string | null,
  customAdapter?: PODFulfillmentProvider,
): Promise<{ ok: true; fulfillment: FulfillmentRecord } | { ok: false; error: string; fulfillment?: FulfillmentRecord }> {
  const dbAdminId = isUUID(adminId) ? adminId : null;

  // ATOMIC RETRY CLAIM (Requirement #1: Status MUST be strictly QUEUED)
  if (hasSupabaseConfig()) {
    const fulfillment = await getFulfillmentByIdAdmin(fulfillmentId);
    if (!fulfillment) return { ok: false, error: "Fulfillment record not found" };
    if (fulfillment.status === "SUBMITTING") return { ok: false, error: "already_claimed", fulfillment };
    if (fulfillment.status === "RECONCILIATION_REQUIRED") return { ok: false, error: "reconciliation_required", fulfillment };
    if (fulfillment.status !== "QUEUED") return { ok: false, error: `invalid_retry_state: status is ${fulfillment.status}`, fulfillment };
    if (fulfillment.providerOrderId) return { ok: false, error: "already_submitted", fulfillment };

    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      return { ok: false, error: "Server configuration error: Supabase service client unavailable" };
    }

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("claim_fulfillment_retry_with_audit", {
      p_fulfillment_id: fulfillmentId,
      p_admin_id: dbAdminId,
    });

    if (rpcErr) return { ok: false, error: rpcErr.message, fulfillment };
    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      const errStr = (rpcData as { error?: string })?.error || "Retry claim failed";
      return { ok: false, error: errStr, fulfillment };
    }
  } else {
    // Synchronous memory claim (prevents async race condition in memory mode)
    const rec = memoryFulfillments.get(fulfillmentId);
    if (!rec) return { ok: false, error: "Fulfillment not found" };
    if (rec.providerOrderId) return { ok: false, error: "already_submitted", fulfillment: rec };
    if (rec.status === "SUBMITTING") return { ok: false, error: "already_claimed", fulfillment: rec };
    if (rec.status === "RECONCILIATION_REQUIRED") return { ok: false, error: "reconciliation_required", fulfillment: rec };
    if (rec.status !== "QUEUED") return { ok: false, error: `invalid_retry_state: status is ${rec.status}`, fulfillment: rec };
    if (!rec.retryable || rec.attemptCount >= (rec.maxAttempts || 3)) {
      return { ok: false, error: "retry_exhausted", fulfillment: rec };
    }
    rec.status = "SUBMITTING";
    rec.attemptCount += 1;
    rec.updatedAt = new Date().toISOString();
  }

  // Atomically claimed -> now invoke adapter submission
  return submitFulfillmentToProviderAdmin(fulfillmentId, adminId, customAdapter);
}

/**
 * Reconciles an ambiguous fulfillment submission in RECONCILIATION_REQUIRED state.
 * (Requirement #12)
 */
export async function reconcileSubmissionAdmin(
  fulfillmentId: string,
  adminId?: string | null,
  customAdapter?: PODFulfillmentProvider,
): Promise<{ ok: true; fulfillment: FulfillmentRecord } | { ok: false; error: string; fulfillment?: FulfillmentRecord }> {
  const fulfillment = await getFulfillmentByIdAdmin(fulfillmentId);
  if (!fulfillment) {
    return { ok: false, error: "Fulfillment record not found" };
  }

  if (fulfillment.status !== "RECONCILIATION_REQUIRED") {
    return { ok: false, error: `Fulfillment is in status ${fulfillment.status}, not RECONCILIATION_REQUIRED`, fulfillment };
  }

  if (!fulfillment.snapshotJson) {
    return { ok: false, error: "Fulfillment snapshot missing", fulfillment };
  }

  let adapter: PODFulfillmentProvider;
  try {
    adapter = customAdapter || getFulfillmentProviderAdapter(fulfillment.snapshotJson.providerSlug);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "provider_adapter_mismatch", fulfillment };
  }

  // Requirement #12: If lookup capability is unverified, return QIKINK_RECONCILIATION_API_UNVERIFIED
  if (!adapter.capabilities.orderLookup) {
    return { ok: false, error: "QIKINK_RECONCILIATION_API_UNVERIFIED", fulfillment };
  }

  const lookup = await adapter.getOrder("", fulfillment.providerReference);
  if (lookup.found && lookup.providerOrderId) {
    const bindRes = await bindProviderOrderAdmin(
      fulfillmentId,
      lookup.providerOrderId,
      lookup.providerStatus || "PRINTING",
      lookup.normalizedStatus || "PROCESSING",
      redactSecrets(lookup.rawResponse || {}),
      adminId,
    );
    if (!bindRes.ok) {
      return { ok: false, error: bindRes.error, fulfillment };
    }
    const updated = await getFulfillmentByIdAdmin(fulfillmentId);
    return { ok: true, fulfillment: updated! };
  }

  return { ok: false, error: "Provider order lookup did not find order by reference. Manual review required.", fulfillment };
}

/**
 * Binds provider order ID to fulfillment record.
 * Enforces provider-scoped uniqueness and rebound protection. (Requirement #25 & #26)
 */
export async function bindProviderOrderAdmin(
  fulfillmentId: string,
  providerOrderId: string,
  providerStatus: string,
  normalizedStatus: FulfillmentStatus,
  metadata: Record<string, unknown>,
  adminId?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dbAdminId = isUUID(adminId) ? adminId : null;

  const existing = await getFulfillmentByIdAdmin(fulfillmentId);
  if (existing && existing.providerOrderId && existing.providerOrderId !== providerOrderId) {
    return { ok: false, error: "provider_order_rebound" };
  }

  if (existing && !isValidStatusTransition(existing.status, normalizedStatus)) {
    return { ok: false, error: `invalid_status_transition: cannot move from ${existing.status} to ${normalizedStatus}` };
  }

  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) return { ok: false, error: "Server configuration error: Supabase service client unavailable" };

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("bind_provider_order_with_audit", {
      p_fulfillment_id: fulfillmentId,
      p_provider_order_id: providerOrderId,
      p_provider_status: providerStatus,
      p_normalized_status: normalizedStatus,
      p_metadata_json: redactSecrets(metadata),
      p_admin_id: dbAdminId,
    });

    if (rpcErr) return { ok: false, error: rpcErr.message };
    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      return { ok: false, error: (rpcData as { error?: string })?.error || "Failed to bind provider order" };
    }

    return { ok: true };
  }

  if (existing) {
    existing.providerOrderId = providerOrderId;
    existing.providerStatus = providerStatus;
    existing.status = normalizedStatus;
    existing.submittedAt = existing.submittedAt || new Date().toISOString();
    existing.lastSyncedAt = new Date().toISOString();
    existing.metadataJson = { ...(existing.metadataJson || {}), ...redactSecrets(metadata) };
    existing.updatedAt = new Date().toISOString();
    memoryFulfillments.set(fulfillmentId, existing);
  }

  return { ok: true };
}

/**
 * Updates status and tracking details with controlled status transitions.
 * (Requirement #21 & #25)
 */
export async function updateFulfillmentStatusAdmin(
  fulfillmentId: string,
  status: FulfillmentStatus,
  providerStatus?: string,
  failureCode?: string,
  failureMessage?: string,
  trackingNumber?: string,
  courierName?: string,
  adminId?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dbAdminId = isUUID(adminId) ? adminId : null;

  // Enforce controlled status transitions (Requirement #21 / #8)
  const existing = await getFulfillmentByIdAdmin(fulfillmentId);
  if (existing) {
    if (!isValidStatusTransition(existing.status, status)) {
      return { ok: false, error: `invalid_status_transition: cannot move from ${existing.status} to ${status}` };
    }
  }

  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) return { ok: false, error: "Server configuration error: Supabase service client unavailable" };

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("update_fulfillment_status_with_audit", {
      p_fulfillment_id: fulfillmentId,
      p_status: status,
      p_provider_status: providerStatus || null,
      p_failure_code: failureCode || null,
      p_failure_message: failureMessage || null,
      p_tracking_number: trackingNumber || null,
      p_courier_name: courierName || null,
      p_admin_id: dbAdminId,
    });

    if (rpcErr) return { ok: false, error: rpcErr.message };
    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      return { ok: false, error: (rpcData as { error?: string })?.error || "Failed to update fulfillment status" };
    }

    return { ok: true };
  }

  // Waybill rebound protection (Requirement #2 & #25)
  if (trackingNumber) {
    const existingWaybill = Array.from(memoryFulfillments.values()).find(
      (f) => f.id !== fulfillmentId && f.trackingNumber === trackingNumber,
    );
    if (existingWaybill) {
      return { ok: false, error: "shipment_waybill_rebound" };
    }
  }

  if (existing) {
    existing.status = status;
    if (providerStatus) existing.providerStatus = providerStatus;
    if (failureCode) existing.failureCode = failureCode;
    if (failureMessage) existing.failureMessage = failureMessage;
    if (trackingNumber) existing.trackingNumber = trackingNumber;
    if (courierName) existing.courierName = courierName;
    if (["FAILED"].includes(status)) existing.failedAt = existing.failedAt || new Date().toISOString();
    existing.lastSyncedAt = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    memoryFulfillments.set(fulfillmentId, existing);
  }

  return { ok: true };
}
