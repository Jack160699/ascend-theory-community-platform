/**
 * Phase 7 — Authoritative Reuse Matching Engine (Requirements #2, #3, #5)
 * Matches order items against available returned inventory by exact manufactured identity hash.
 * Includes product, variant, SKU, design IDs/versions, artwork checksums, placements, print methods, dimensions, and transform scales/rotations.
 */

import crypto from "node:crypto";
import type { Order, OrderItem } from "@/lib/orders/types";
import type { ReturnedInventoryItem } from "@/lib/cod/types";
import { getAllReturnedInventoryAdmin } from "./returned-store";

export type ManufacturingIdentityInput = {
  productId: string;
  variantId: string;
  sku: string;
  designs?: { designId: string; version: number; checksum?: string }[];
  placements?: {
    placementId: string;
    location: string;
    printMethod: string;
    xNormalized?: number;
    yNormalized?: number;
    widthMm?: number;
    heightMm?: number;
    scale?: number;
    rotationDeg?: number;
  }[];
};

/**
 * Computes deterministic SHA-256 hash of exact manufacturing intent using recursive canonicalization.
 */
export function computeManufacturingIdentityHash(input: ManufacturingIdentityInput): string {
  if (!input.productId || !input.variantId || !input.sku) {
    throw new Error("[ManufacturingHash] Missing required product, variant, or SKU");
  }

  const sortedDesigns = (input.designs || [])
    .map((d) => ({
      dId: String(d.designId || "").trim(),
      ver: Number(d.version || 1),
      chk: String(d.checksum || "").trim(),
    }))
    .sort((a, b) => a.dId.localeCompare(b.dId) || a.ver - b.ver || a.chk.localeCompare(b.chk));

  const sortedPlacements = (input.placements || [])
    .map((p) => ({
      pId: String(p.placementId || "").trim(),
      loc: String(p.location || "").trim(),
      pm: String(p.printMethod || "").trim(),
      x: Number(p.xNormalized ?? 0.5),
      y: Number(p.yNormalized ?? 0.5),
      w: Number(p.widthMm || 0),
      h: Number(p.heightMm || 0),
      s: Number(p.scale ?? 1),
      r: Number(p.rotationDeg ?? 0),
    }))
    .sort((a, b) => a.pId.localeCompare(b.pId) || a.loc.localeCompare(b.loc) || a.pm.localeCompare(b.pm));

  const canonicalPayload = JSON.stringify({
    p: String(input.productId).trim(),
    v: String(input.variantId).trim(),
    s: String(input.sku).trim(),
    d: sortedDesigns,
    pl: sortedPlacements,
  });

  return crypto.createHash("sha256").update(canonicalPayload).digest("hex");
}

export async function findMatchingReturnedInventory(
  orderItem: OrderItem,
  manufacturingInput: ManufacturingIdentityInput,
): Promise<ReturnedInventoryItem[]> {
  const targetHash = computeManufacturingIdentityHash(manufacturingInput);
  if (!targetHash) return [];

  const allInventory = await getAllReturnedInventoryAdmin();

  return allInventory.filter((item) => {
    // 1. Must be REUSABLE and reuseEligible
    if (item.reuseStatus !== "REUSABLE" || !item.reuseEligible) {
      return false;
    }

    // 2. Require non-empty manufacturing identity hash
    if (!item.manufacturingIdentityHash || !item.manufacturingIdentityHash.trim()) {
      return false;
    }

    // 3. Strict match: item.manufacturingIdentityHash MUST equal targetHash
    if (item.manufacturingIdentityHash !== targetHash) {
      return false;
    }

    return true;
  });
}

/**
 * Gate Check: Ensures COD orders MUST be COD_APPROVED and Prepaid orders MUST be captured before inventory reservation.
 */
export function canReserveReturnedInventoryForOrder(order: Order): { allowed: boolean; reason?: string } {
  const isCod = order.paymentMethod === "cod" || Boolean(order.isCod);
  if (isCod) {
    if (order.codStatus !== "COD_APPROVED") {
      return {
        allowed: false,
        reason: "cod_approval_required: COD order must be COD_APPROVED before returned inventory reservation",
      };
    }
  } else {
    if (order.paymentStatus !== "captured" && order.status !== "paid") {
      return {
        allowed: false,
        reason: "prepaid_capture_required: Prepaid order must be captured before returned inventory reservation",
      };
    }
  }

  return { allowed: true };
}

/**
 * Authoritative Manufacturing Identity Builder (Requirement #14).
 * Derives physical manufacturing identity from Phase 5/6 design store data.
 * Does NOT trust cart/customer input for designs or placements.
 */
export async function buildAuthoritativeManufacturingIdentity(
  productId: string,
  variantId: string,
  sku: string,
): Promise<{ hash: string; snapshot: ManufacturingIdentityInput }> {
  const { getAllDesignsAdmin } = await import("@/lib/wearables/design-store");
  const allDesigns = await getAllDesignsAdmin();

  const designs: ManufacturingIdentityInput["designs"] = [];
  const placements: ManufacturingIdentityInput["placements"] = [];

  for (const design of allDesigns) {
    if (design.status !== "active") continue;
    const matchingPlacements = (design.placements || []).filter(
      (p) => p.productId === productId && (p.productVariantId === variantId || !p.productVariantId) && p.isActive,
    );
    if (matchingPlacements.length > 0) {
      designs.push({
        designId: design.id,
        version: design.version ?? 1,
        checksum: design.checksum || "",
      });
      for (const p of matchingPlacements) {
        placements.push({
          placementId: p.id,
          location: p.placementLocation || p.position || "",
          printMethod: p.printMethod || "dtf",
          xNormalized: p.xNormalized,
          yNormalized: p.yNormalized,
          widthMm: p.widthMm || 0,
          heightMm: p.heightMm || 0,
          scale: p.scale ?? 1,
          rotationDeg: p.rotationDeg ?? 0,
        });
      }
    }
  }

  const input: ManufacturingIdentityInput = {
    productId,
    variantId,
    sku,
    designs,
    placements,
  };

  const hash = computeManufacturingIdentityHash(input);
  return { hash, snapshot: input };
}
