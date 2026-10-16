/**
 * Phase 6 — Authoritative Snapshot Staleness Validator
 * Verifies that all exact frozen prerequisites (provider mapping, variants, placements,
 * design version, exact checksum, and storage artwork existence) remain 100% active and unmutated
 * prior to first provider submission.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { getAllDesignsAdmin, getAllProviderMappingsAdmin, getAllPODProvidersAdmin } from "@/lib/wearables/design-store";
import type { FulfillmentSnapshot } from "./types";

export type SnapshotValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export async function validateFulfillmentSnapshotBeforeFirstSubmission(
  snapshot: FulfillmentSnapshot,
): Promise<SnapshotValidationResult> {
  // 1. Verify Provider
  const providers = await getAllPODProvidersAdmin();
  const provider = providers.find((p) => p.id === snapshot.providerId);
  if (!provider || !provider.isActive || provider.slug !== snapshot.providerSlug) {
    return { valid: false, reason: "snapshot_provider_mapping_stale" };
  }

  const mappings = await getAllProviderMappingsAdmin();
  const designs = await getAllDesignsAdmin();
  const designsMap = new Map(designs.map((d) => [d.id, d]));
  const placementsList = designs.flatMap((d) => d.placements || []);
  const placementsMap = new Map(placementsList.map((p) => [p.id, p]));

  // 2. Verify Items & Mappings
  for (const item of snapshot.items || []) {
    const pProd = mappings.providerProducts.find((pp) => pp.id === item.providerProductMappingId);
    if (
      !pProd ||
      pProd.mappingStatus !== "verified" ||
      pProd.providerId !== snapshot.providerId ||
      pProd.productId !== item.productId ||
      pProd.externalProductId !== item.providerExternalProductId
    ) {
      return { valid: false, reason: "snapshot_provider_mapping_stale" };
    }

    const pVar = mappings.providerVariants.find((pv) => pv.id === item.providerVariantMappingId);
    if (
      !pVar ||
      pVar.mappingStatus !== "verified" ||
      pVar.productVariantId !== item.variantId ||
      pVar.providerProductId !== pProd.id ||
      pVar.externalVariantId !== item.providerExternalVariantId ||
      (pVar.externalSku || pVar.sku || "") !== item.providerExternalSku
    ) {
      return { valid: false, reason: "snapshot_provider_mapping_stale" };
    }

    // 3. Verify Placements & Designs
    for (const snapPl of item.placements || []) {
      const pl = placementsMap.get(snapPl.placementId);
      if (
        !pl ||
        !pl.isActive ||
        pl.designId !== snapPl.designId ||
        pl.productVariantId !== item.variantId ||
        pl.placementLocation !== snapPl.placementLocation ||
        pl.xNormalized !== snapPl.xNormalized ||
        pl.yNormalized !== snapPl.yNormalized ||
        pl.scale !== snapPl.scale ||
        pl.rotationDeg !== snapPl.rotationDeg ||
        pl.widthMm !== snapPl.widthMm ||
        pl.heightMm !== snapPl.heightMm ||
        pl.printMethod !== snapPl.printMethod
      ) {
        return { valid: false, reason: "snapshot_placement_stale" };
      }

      const design = designsMap.get(snapPl.designId);
      if (
        !design ||
        design.status !== "active" ||
        design.id !== snapPl.designId ||
        (design.version ?? 1) !== snapPl.designVersion ||
        design.storagePath !== snapPl.storagePath ||
        (design.checksum ?? null) !== (snapPl.checksum ?? null) // Requirement #8: Exact normalized checksum equality
      ) {
        return { valid: false, reason: "snapshot_design_stale" };
      }

      // Requirement #9: Exact storage object existence check (fail closed if service client unavailable)
      if (hasSupabaseConfig() && snapPl.storagePath) {
        const supabase = createSupabaseServiceClient();
        if (!supabase) {
          return { valid: false, reason: "snapshot_artwork_missing" };
        }

        const pathParts = snapPl.storagePath.split("/");
        const fileName = pathParts.pop();
        const folderPath = pathParts.join("/");

        const { data: listData, error: listErr } = await supabase.storage
          .from("design-artwork")
          .list(folderPath, { search: fileName });

        if (listErr || !listData || listData.length === 0) {
          return { valid: false, reason: "snapshot_artwork_missing" };
        }

        const exactMatch = listData.some((entry) => entry.name === fileName);
        if (!exactMatch) {
          return { valid: false, reason: "snapshot_artwork_missing" };
        }
      }
    }
  }

  return { valid: true };
}
