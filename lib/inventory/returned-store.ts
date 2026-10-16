/**
 * Phase 7 — Authoritative Returned Inventory Store & Concurrency Manager (Requirements #2, #4, #5, #6)
 * Handles physical returned items with exact manufactured identity hash and snapshot.
 * All reservations MUST go through one transactional RPC `reserve_matching_returned_inventory_with_audit`.
 * Fails closed on database errors when Supabase is configured.
 */

import crypto from "node:crypto";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ReturnedInventoryItem, ReuseStatus, GarmentCondition } from "@/lib/cod/types";
import { computeManufacturingIdentityHash, type ManufacturingIdentityInput } from "./reuse-engine";

const memoryReturnedInventory = new Map<string, ReturnedInventoryItem>();

export function calculateAgeDays(receivedAt: string): number {
  const receivedMs = new Date(receivedAt).getTime();
  const nowMs = Date.now();
  const diffDays = Math.floor((nowMs - receivedMs) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 ? diffDays : 0;
}

export function getAgeingBucket(ageDays: number): "0-7 days" | "8-30 days" | "31-60 days" | "60+ days" {
  if (ageDays <= 7) return "0-7 days";
  if (ageDays <= 30) return "8-30 days";
  if (ageDays <= 60) return "31-60 days";
  return "60+ days";
}

export async function saveReturnedInventoryItemAdmin(
  item: Partial<ReturnedInventoryItem> & {
    productId: string;
    variantId: string;
    designId: string;
    designVersion: number;
    sku: string;
    manufacturingInput?: ManufacturingIdentityInput;
  },
  adminId?: string | null,
): Promise<ReturnedInventoryItem> {
  const id = item.id || crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const receivedAt = item.receivedAt || nowIso;
  const ageDays = calculateAgeDays(receivedAt);

  let hash = item.manufacturingIdentityHash || "";
  let snapshot = item.manufacturingSnapshotJson || null;

  if (item.manufacturingInput) {
    hash = computeManufacturingIdentityHash(item.manufacturingInput);
    snapshot = item.manufacturingInput as unknown as Record<string, unknown>;
  }

  // Requirement #15: If source_order_item_id is provided, load source order item and copy its stored authoritative hash/snapshot
  if (item.sourceOrderItemId && item.sourceOrderId) {
    const { getOrderAdmin } = await import("@/lib/orders/store");
    const srcOrder = await getOrderAdmin(item.sourceOrderId);
    if (srcOrder && srcOrder.items) {
      const srcItem = srcOrder.items.find(
        (i) => i.orderItemId === item.sourceOrderItemId || i.productId === item.productId,
      );
      if (srcItem) {
        if (
          (item.productId && srcItem.productId && item.productId !== srcItem.productId) ||
          (item.variantId && srcItem.variantId && item.variantId !== srcItem.variantId) ||
          (item.sku && srcItem.sku && item.sku !== srcItem.sku)
        ) {
          throw new Error("source_order_item_identity_mismatch: item attributes do not match source order item");
        }
        if (srcItem.manufacturingIdentityHash) {
          hash = srcItem.manufacturingIdentityHash;
          snapshot = (srcItem.manufacturingSnapshotJson || null) as Record<string, unknown> | null;
        }
      }
    }
  }

  // If item lacks an exact manufacturing snapshot/hash, store for inspection but mark reuse_eligible = false
  const reuseEligible = Boolean(hash && snapshot && item.reuseEligible !== false);
  const reuseStatus: ReuseStatus = reuseEligible ? item.reuseStatus || "REUSABLE" : "INSPECTION_REQUIRED";

  const fullRecord: ReturnedInventoryItem = {
    id,
    sourceOrderId: item.sourceOrderId,
    sourceOrderItemId: item.sourceOrderItemId,
    fulfillmentId: item.fulfillmentId,
    productId: item.productId,
    variantId: item.variantId,
    designId: item.designId,
    designVersion: item.designVersion,
    sku: item.sku,
    size: item.size,
    color: item.color,
    condition: item.condition || "NEW_UNWORN",
    manufacturingIdentityHash: hash,
    manufacturingSnapshotJson: snapshot || undefined,
    receivedAt,
    ageDays,
    reuseStatus,
    reuseEligible,
    notes: item.notes,
    disposedAt: item.disposedAt,
    reusedAt: item.reusedAt,
    replacementOrderId: item.replacementOrderId,
    createdAt: item.createdAt || nowIso,
    updatedAt: nowIso,
  };

  if (hasSupabaseConfig()) {
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      throw new Error("[ReturnedInventory] Supabase service role client unconfigured.");
    }

    const { data: rpcRes, error: rpcErr } = await supabase.rpc("save_returned_inventory_with_audit", {
      p_id: fullRecord.id,
      p_source_order_id: fullRecord.sourceOrderId || null,
      p_source_order_item_id: fullRecord.sourceOrderItemId || null,
      p_fulfillment_id: fullRecord.fulfillmentId || null,
      p_product_id: fullRecord.productId,
      p_variant_id: fullRecord.variantId,
      p_design_id: fullRecord.designId,
      p_design_version: fullRecord.designVersion,
      p_sku: fullRecord.sku,
      p_size: fullRecord.size || null,
      p_color: fullRecord.color || null,
      p_condition: fullRecord.condition,
      p_manufacturing_identity_hash: fullRecord.manufacturingIdentityHash,
      p_manufacturing_snapshot_json: fullRecord.manufacturingSnapshotJson || {},
      p_received_at: fullRecord.receivedAt,
      p_reuse_status: fullRecord.reuseStatus,
      p_reuse_eligible: fullRecord.reuseEligible,
      p_notes: fullRecord.notes || null,
      p_admin_id: adminId || null,
    });

    if (rpcErr || !rpcRes || rpcRes.ok === false) {
      const errMsg = rpcRes?.error || rpcErr?.message || "Unknown RPC error";
      console.error("[ReturnedInventory] DB error saving inventory item via RPC:", errMsg);
      throw new Error(`Failed to save returned inventory via RPC: ${errMsg}`);
    }

    const { data: fetchedRow } = await supabase
      .from("returned_inventory")
      .select("*")
      .eq("id", fullRecord.id)
      .maybeSingle();

    if (fetchedRow) {
      const authoritativeItem: ReturnedInventoryItem = {
        id: fetchedRow.id,
        sourceOrderId: fetchedRow.source_order_id,
        sourceOrderItemId: fetchedRow.source_order_item_id,
        fulfillmentId: fetchedRow.fulfillment_id,
        productId: fetchedRow.product_id,
        variantId: fetchedRow.variant_id,
        designId: fetchedRow.design_id,
        designVersion: fetchedRow.design_version,
        sku: fetchedRow.sku,
        size: fetchedRow.size,
        color: fetchedRow.color,
        condition: fetchedRow.condition as GarmentCondition,
        manufacturingIdentityHash: fetchedRow.manufacturing_identity_hash || "",
        manufacturingSnapshotJson: fetchedRow.manufacturing_snapshot_json || undefined,
        receivedAt: fetchedRow.received_at,
        ageDays: calculateAgeDays(fetchedRow.received_at),
        reuseStatus: fetchedRow.reuse_status as ReuseStatus,
        reuseEligible: fetchedRow.reuse_eligible,
        notes: fetchedRow.notes,
        disposedAt: fetchedRow.disposed_at,
        reusedAt: fetchedRow.reused_at,
        replacementOrderId: fetchedRow.replacement_order_id,
        createdAt: fetchedRow.created_at,
        updatedAt: fetchedRow.updated_at,
      };
      memoryReturnedInventory.set(id, authoritativeItem);
      return authoritativeItem;
    }
  }

  memoryReturnedInventory.set(id, fullRecord);
  return fullRecord;
}

export async function getAllReturnedInventoryAdmin(): Promise<ReturnedInventoryItem[]> {
  if (hasSupabaseConfig()) {
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      throw new Error("[ReturnedInventory] Supabase service role client unconfigured.");
    }
    const { data, error } = await supabase
      .from("returned_inventory")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[ReturnedInventory] DB error querying returned inventory:", error);
      throw new Error(`Failed to read returned inventory from Supabase: ${error.message}`);
    }

    return (data || []).map((d) => ({
      id: d.id,
      sourceOrderId: d.source_order_id,
      sourceOrderItemId: d.source_order_item_id,
      fulfillmentId: d.fulfillment_id,
      productId: d.product_id,
      variantId: d.variant_id,
      designId: d.design_id,
      designVersion: d.design_version,
      sku: d.sku,
      size: d.size,
      color: d.color,
      condition: d.condition as GarmentCondition,
      manufacturingIdentityHash: d.manufacturing_identity_hash || "",
      manufacturingSnapshotJson: d.manufacturing_snapshot_json || undefined,
      receivedAt: d.received_at,
      ageDays: calculateAgeDays(d.received_at),
      reuseStatus: d.reuse_status as ReuseStatus,
      reuseEligible: d.reuse_eligible,
      notes: d.notes,
      disposedAt: d.disposed_at,
      reusedAt: d.reused_at,
      replacementOrderId: d.replacement_order_id,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  }

  return Array.from(memoryReturnedInventory.values()).map((item) => ({
    ...item,
    ageDays: calculateAgeDays(item.receivedAt),
  }));
}

/**
 * Authoritative Returned Inventory Reservation via RPC ONLY (Requirements #4 & #5)
 * NO DIRECT DB UPDATE BYPASS.
 */
export async function reserveReturnedInventoryAdmin(
  orderItemId: string,
  adminId?: string | null,
): Promise<{ ok: true; item: ReturnedInventoryItem } | { ok: false; error: string }> {
  if (hasSupabaseConfig()) {
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      return { ok: false, error: "Supabase service client unconfigured" };
    }

    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "reserve_matching_returned_inventory_with_audit",
      {
        p_order_item_id: orderItemId,
        p_admin_id: adminId || null,
      },
    );

    if (rpcErr || !rpcData || !(rpcData as { ok?: boolean }).ok) {
      const errStr =
        (rpcData as { error?: string })?.error || rpcErr?.message || "Reservation failed";
      return { ok: false, error: errStr };
    }

    const reservedId = (rpcData as { reserved_item_id?: string }).reserved_item_id;
    const all = await getAllReturnedInventoryAdmin();
    const updated = all.find((i) => i.id === reservedId);
    return updated ? { ok: true, item: updated } : { ok: false, error: "Item not found after reservation" };
  }

  // Memory fallback with atomic check for dev/testing
  const allInv = Array.from(memoryReturnedInventory.values());
  const reusable = allInv.find((i) => i.reuseStatus === "REUSABLE" && i.reuseEligible && Boolean(i.manufacturingIdentityHash));

  if (!reusable) {
    return { ok: false, error: "no_matching_returned_inventory_available" };
  }

  reusable.reuseStatus = "RESERVED";
  reusable.updatedAt = new Date().toISOString();
  memoryReturnedInventory.set(reusable.id, reusable);

  return { ok: true, item: reusable };
}
