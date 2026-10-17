/**
 * Phase 6 — Stable Manufacturing Intent Canonicalizer & Hash Generator
 * Recursively canonicalizes snapshot intent while stripping volatile execution fields
 * (fulfillmentId, createdAt, requestHash, transientSignedUrl).
 * Sorts items by orderItemId and placements by placementId for exact determinism.
 */

import crypto from "node:crypto";
import type { FulfillmentSnapshot } from "./types";

function sortValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map(sortValue);
  }
  if (typeof val === "object") {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(val as Record<string, unknown>).sort();
    for (const key of keys) {
      sortedObj[key] = sortValue((val as Record<string, unknown>)[key]);
    }
    return sortedObj;
  }
  return val;
}

export function canonicalizeManufacturingIntent(snapshot: FulfillmentSnapshot): string {
  // Sort items deterministically by orderItemId
  const sortedItems = (snapshot.items || [])
    .slice()
    .sort((a, b) => (a.orderItemId || "").localeCompare(b.orderItemId || ""))
    .map((item) => {
      // Sort placements deterministically by placementId
      const sortedPlacements = (item.placements || [])
        .slice()
        .sort((a, b) => (a.placementId || "").localeCompare(b.placementId || ""))
        .map((pl) => ({
          placementId: pl.placementId,
          designId: pl.designId,
          designVersion: pl.designVersion ?? 1,
          designSlug: pl.designSlug,
          designTitle: pl.designTitle,
          storagePath: pl.storagePath,
          checksum: pl.checksum,
          placementLocation: pl.placementLocation,
          xNormalized: pl.xNormalized,
          yNormalized: pl.yNormalized,
          scale: pl.scale,
          rotationDeg: pl.rotationDeg,
          widthMm: pl.widthMm,
          heightMm: pl.heightMm,
          printMethod: pl.printMethod,
        }));

      return {
        orderItemId: item.orderItemId,
        productId: item.productId,
        variantId: item.variantId,
        ascendSku: item.ascendSku,
        quantity: item.quantity,
        providerProductMappingId: item.providerProductMappingId,
        providerExternalProductId: item.providerExternalProductId,
        providerVariantMappingId: item.providerVariantMappingId,
        providerExternalVariantId: item.providerExternalVariantId,
        providerExternalSku: item.providerExternalSku,
        placements: sortedPlacements,
      };
    });

  const intent = {
    orderId: snapshot.orderId,
    orderNumber: snapshot.orderNumber,
    items: sortedItems,
    providerId: snapshot.providerId,
    providerSlug: snapshot.providerSlug,
    customerShipping: {
      fullName: snapshot.customerShipping?.fullName,
      email: snapshot.customerShipping?.email,
      phone: snapshot.customerShipping?.phone,
      addressLine1: snapshot.customerShipping?.addressLine1,
      addressLine2: snapshot.customerShipping?.addressLine2,
      city: snapshot.customerShipping?.city,
      state: snapshot.customerShipping?.state,
      postalCode: snapshot.customerShipping?.postalCode,
      country: snapshot.customerShipping?.country,
    },
    isCod: snapshot.isCod,
    paymentMode: snapshot.paymentMode,
    currency: snapshot.currency,
  };

  const sortedObject = sortValue(intent);
  return JSON.stringify(sortedObject);
}

export function computeManufacturingIntentHash(snapshot: FulfillmentSnapshot): string {
  const canonicalJson = canonicalizeManufacturingIntent(snapshot);
  return crypto.createHash("sha256").update(canonicalJson).digest("hex");
}
