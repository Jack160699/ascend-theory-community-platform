/**
 * Qikink garment catalogue (pod_garments). Each garment knows its Qikink SKU pattern
 * (prefix-colourCode-sizeCode), colours, sizes, base cost and which print types it takes.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { PrintMethod } from "@/lib/wearables/design-types";

import type { Garment, GarmentColour, GarmentSize } from "./pricing";
import { qikinkSku } from "./pricing";

export type { Garment, GarmentColour, GarmentSize } from "./pricing";
export { estimateCostInr, parseQikinkSku, qikinkSku, suggestedPriceInr, QIKINK_SHIPPING, GST_RATE } from "./pricing";
export type { CostBreakdown, PlacementCostInput } from "./pricing";

const STANDARD_COLOURS: GarmentColour[] = [
  { name: "Black", code: "Bk", hex: "#151515" },
  { name: "White", code: "Wh", hex: "#f4f4f2" },
  { name: "Navy Blue", code: "Nb", hex: "#1d2740" },
];
const STANDARD_SIZES: GarmentSize[] = ["S", "M", "L", "XL", "XXL"].map((s) => ({ size: s, code: s }));
const ALL_FINISHES: PrintMethod[] = ["dtg", "dtf", "embroidery", "puff", "vinyl_gold", "vinyl_silver", "glow", "vinyl_reflective"];

/** Mirrors the seed in the 20261023 migration; used when Supabase isn't configured (dev/tests). */
export const DEFAULT_GARMENTS: Garment[] = [
  { id: "g-heavy", key: "heavy_tee", name: "Heavyweight tee · 240 GSM", qikinkStyle: "UC48", skuPrefix: "UC48", skuConfirmed: false, colours: STANDARD_COLOURS.slice(0, 2), sizes: STANDARD_SIZES, baseCostInr: 260, weightGrams: 300, printTypes: ALL_FINISHES, sortOrder: -1, isActive: true },
  { id: "g-oversized", key: "oversized_tee", name: "Oversized tee", qikinkStyle: "US22", skuPrefix: "UOsHs", skuConfirmed: false, colours: STANDARD_COLOURS, sizes: STANDARD_SIZES, baseCostInr: 235, weightGrams: 300, printTypes: ALL_FINISHES, sortOrder: 1, isActive: true },
  { id: "g-tee", key: "tee", name: "Classic crew tee · 180 GSM", qikinkStyle: "UC21", skuPrefix: "MRnHs", skuConfirmed: false, colours: STANDARD_COLOURS, sizes: STANDARD_SIZES, baseCostInr: 190, weightGrams: 250, printTypes: [...ALL_FINISHES, "sublimation"], sortOrder: 0, isActive: true },
  { id: "g-hoodie", key: "hoodie", name: "Pullover hoodie", qikinkStyle: "UH83", skuPrefix: "UPuHd", skuConfirmed: false, colours: STANDARD_COLOURS, sizes: STANDARD_SIZES, baseCostInr: 480, weightGrams: 650, printTypes: ALL_FINISHES, sortOrder: 3, isActive: true },
  { id: "g-sweatshirt", key: "sweatshirt", name: "Sweatshirt", qikinkStyle: "UH26", skuPrefix: "USwFs", skuConfirmed: false, colours: STANDARD_COLOURS, sizes: STANDARD_SIZES, baseCostInr: 410, weightGrams: 550, printTypes: ALL_FINISHES, sortOrder: 4, isActive: true },
];

function rowToGarment(r: Record<string, unknown>): Garment {
  return {
    id: String(r.id),
    key: String(r.key),
    name: String(r.name),
    qikinkStyle: r.qikink_style ? String(r.qikink_style) : undefined,
    skuPrefix: String(r.sku_prefix),
    skuConfirmed: Boolean(r.sku_confirmed),
    colours: (r.colours as GarmentColour[]) ?? [],
    sizes: (r.sizes as GarmentSize[]) ?? [],
    baseCostInr: Number(r.base_cost_inr ?? 0),
    weightGrams: Number(r.weight_grams ?? 300),
    printTypes: ((r.print_types as string[]) ?? []) as PrintMethod[],
    sortOrder: Number(r.sort_order ?? 0),
    isActive: Boolean(r.is_active),
  };
}

export async function listGarments(): Promise<Garment[]> {
  const db = createSupabaseServiceClient();
  if (!db) return DEFAULT_GARMENTS;
  const { data, error } = await db.from("pod_garments").select("*").order("sort_order");
  if (error) throw new Error(`Couldn't load garments: ${error.message}`);
  return (data ?? []).map(rowToGarment);
}

export async function getGarment(key: string): Promise<Garment | undefined> {
  return (await listGarments()).find((g) => g.key === key);
}

export type GarmentUpdate = Partial<
  Pick<Garment, "name" | "skuPrefix" | "skuConfirmed" | "colours" | "sizes" | "baseCostInr" | "weightGrams" | "printTypes" | "isActive">
>;

export function validateGarmentUpdate(u: GarmentUpdate): string[] {
  const errors: string[] = [];
  if (u.skuPrefix !== undefined && !/^[A-Za-z0-9]{2,20}$/.test(u.skuPrefix)) errors.push("SKU prefix: letters and numbers only.");
  if (u.colours) {
    if (u.colours.length === 0) errors.push("Add at least one colour.");
    u.colours.forEach((c) => {
      if (!c.name.trim() || !/^[A-Za-z0-9]{1,8}$/.test(c.code)) errors.push(`Colour "${c.name || "?"}" needs a Qikink code (e.g. Bk).`);
      if (!/^#[0-9a-fA-F]{6}$/.test(c.hex)) errors.push(`Colour "${c.name}" needs a hex like #151515.`);
    });
  }
  if (u.sizes) {
    if (u.sizes.length === 0) errors.push("Add at least one size.");
    u.sizes.forEach((s) => {
      if (!s.size.trim() || !/^[A-Za-z0-9_]{1,10}$/.test(s.code)) errors.push(`Size "${s.size || "?"}" needs a Qikink code.`);
    });
  }
  if (u.baseCostInr !== undefined && !(u.baseCostInr >= 0)) errors.push("Base cost can't be negative.");
  return errors;
}

export async function updateGarment(key: string, u: GarmentUpdate): Promise<Garment> {
  const errors = validateGarmentUpdate(u);
  if (errors.length) throw new Error(errors.join(" "));
  const db = createSupabaseServiceClient();
  if (!db) throw new Error("Database not configured");
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (u.name !== undefined) row.name = u.name;
  if (u.skuPrefix !== undefined) row.sku_prefix = u.skuPrefix;
  if (u.skuConfirmed !== undefined) row.sku_confirmed = u.skuConfirmed;
  if (u.colours !== undefined) row.colours = u.colours;
  if (u.sizes !== undefined) row.sizes = u.sizes;
  if (u.baseCostInr !== undefined) row.base_cost_inr = u.baseCostInr;
  if (u.weightGrams !== undefined) row.weight_grams = u.weightGrams;
  if (u.printTypes !== undefined) row.print_types = u.printTypes;
  if (u.isActive !== undefined) row.is_active = u.isActive;
  const { data, error } = await db.from("pod_garments").update(row).eq("key", key).select("*").single();
  if (error) throw new Error(`Couldn't save garment: ${error.message}`);
  const garment = rowToGarment(data);
  await resyncGarmentMappings(garment);
  return garment;
}

/**
 * Rewrites the Qikink SKU of every product made on this garment and marks them verified
 * once the garment's codes are confirmed — so confirming once switches on automatic sending.
 */
export async function resyncGarmentMappings(g: Garment): Promise<{ products: number; variants: number }> {
  const db = createSupabaseServiceClient();
  if (!db) return { products: 0, variants: 0 };
  const { data: products } = await db.from("products").select("id").eq("studio_json->>garmentKey", g.key);
  const now = new Date().toISOString();
  let variantsUpdated = 0;
  for (const p of products ?? []) {
    const status = g.skuConfirmed ? "verified" : "mapped";
    const { data: pps } = await db
      .from("provider_products")
      .update({ external_product_id: g.skuPrefix, mapping_status: status, verified_at: g.skuConfirmed ? now : null, updated_at: now })
      .eq("product_id", p.id)
      .select("id");
    const providerProductIds = (pps ?? []).map((r) => r.id);
    if (providerProductIds.length === 0) continue;
    const { data: variants } = await db.from("product_variants").select("id, size, color, color_display").eq("product_id", p.id);
    for (const v of variants ?? []) {
      const colourName = String(v.color_display || v.color || "").toLowerCase();
      const colour = g.colours.find((c) => c.name.toLowerCase() === colourName);
      const size = g.sizes.find((sz) => sz.size.toLowerCase() === String(v.size).toLowerCase());
      const sku = colour && size ? qikinkSku(g, colour, size) : null;
      const update = sku
        ? { external_variant_id: sku, sku, external_sku: sku, provider_color: colour!.name, provider_size: size!.code, mapping_status: status, verified_at: g.skuConfirmed ? now : null, updated_at: now }
        : { mapping_status: "mapped", verified_at: null, updated_at: now };
      const { data: updated } = await db
        .from("provider_variants")
        .update(update)
        .eq("product_variant_id", v.id)
        .in("provider_product_id", providerProductIds)
        .select("id");
      variantsUpdated += updated?.length ?? 0;
    }
  }
  return { products: products?.length ?? 0, variants: variantsUpdated };
}

