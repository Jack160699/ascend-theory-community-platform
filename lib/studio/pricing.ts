/**
 * Pure pricing and SKU helpers (no database) — shared by the server and the HQ studio screens.
 * Qikink costs: Pricing 2026 page, printing charges page and shipping page on qikink.com.
 */

import type { PrintMethod } from "@/lib/wearables/design-types";
import { getPrintType, printChargeInr } from "./print-types";

/** Rate used to show rupee costs next to dollar prices (matches QIKINK_FX_TO_INR's default). */
export const STUDIO_FX_TO_INR = 95;

export type GarmentColour = { name: string; code: string; hex: string };
export type GarmentSize = { size: string; code: string; extraCostInr?: number };

export type Garment = {
  id: string;
  key: string;
  name: string;
  qikinkStyle?: string;
  skuPrefix: string;
  skuConfirmed: boolean;
  colours: GarmentColour[];
  sizes: GarmentSize[];
  baseCostInr: number;
  weightGrams: number;
  printTypes: PrintMethod[];
  sortOrder: number;
  isActive: boolean;
};

/** Qikink SKU, e.g. UPuHd-Bk-M. */
export function qikinkSku(g: Pick<Garment, "skuPrefix">, colour: Pick<GarmentColour, "code">, size: Pick<GarmentSize, "code">): string {
  return `${g.skuPrefix}-${colour.code}-${size.code}`;
}

/**
 * Reads a SKU copied from Qikink (e.g. "UPuHd-Bk-M") so the garment can be confirmed
 * by pasting one real SKU instead of typing codes.
 */
export function parseQikinkSku(sku: string): { prefix: string; colourCode: string; sizeCode: string } | null {
  const m = sku.trim().match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)-([A-Za-z0-9_ ]+)$/);
  if (!m) return null;
  return { prefix: m[1]!, colourCode: m[2]!, sizeCode: m[3]!.trim() };
}

export const QIKINK_SHIPPING = { perHalfKgInr: 63.7, codExtraInr: 40.12 };
export const GST_RATE = 0.05;

export type PlacementCostInput = { printType: PrintMethod; widthIn: number; heightIn: number };

export type CostBreakdown = {
  garment: number;
  print: number;
  gst: number;
  shipping: number;
  total: number;
};

/** Estimated Qikink cost per piece in rupees (garment + print + 5% GST + air shipping). */
export function estimateCostInr(g: Garment, colourName: string, placements: PlacementCostInput[]): CostBreakdown {
  const white = colourName.trim().toLowerCase() === "white";
  const garment = g.baseCostInr;
  const print = placements.reduce((sum, p) => {
    const type = getPrintType(p.printType);
    return sum + (type ? printChargeInr(type, p.widthIn, p.heightIn, white) : 0);
  }, 0);
  const gst = Math.round((garment + print) * GST_RATE);
  const shipping = Math.round(Math.ceil(g.weightGrams / 500) * QIKINK_SHIPPING.perHalfKgInr);
  return { garment, print, gst, shipping, total: garment + print + gst + shipping };
}

/** Price that leaves the target margin after cost, rounded to a ₹…99 retail price. */
export function suggestedPriceInr(costInr: number, marginShare: number): number {
  const raw = costInr / Math.max(0.05, 1 - marginShare);
  return Math.max(99, Math.ceil((raw + 1) / 100) * 100 - 1);
}
