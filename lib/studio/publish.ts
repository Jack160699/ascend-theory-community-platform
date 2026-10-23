/**
 * Publish: one call turns cleaned artwork into a sellable product —
 * Qikink print file (300 DPI), mockups per colour, product, colour × size variants,
 * design + placements, approved mockups and Qikink SKU mappings.
 */

import { randomUUID } from "node:crypto";
import type { PlacementLocation, PrintMethod } from "@/lib/wearables/design-types";
import { estimateCostInr, getGarment, qikinkSku, type Garment } from "./garments";
import { renderMockup, renderPrintFile, toStoreImage, type GarmentShape } from "./image";
import { getPrintType, PLACEMENT_LABEL, type StudioPrintType } from "./print-types";
import {
  ARTWORK_BUCKET,
  db,
  downloadFile,
  isStudioPath,
  MEDIA_BUCKET,
  publicUrl,
  slugify,
  UPLOAD_BUCKET,
  uploadFile,
} from "./server";

export type PublishInput = {
  sourcePath: string;
  artworkPath: string;
  flat: boolean;
  useSourcePhoto: boolean;
  title: string;
  description: string;
  garmentKey: string;
  colours: string[];
  sizes: string[];
  printType: PrintMethod;
  placement: PlacementLocation;
  widthIn: number;
  price: number;
  currency: "INR" | "USD";
  status: "active" | "draft";
  rightsConfirmed: boolean;
  palette?: string[];
};

export type PublishResult = {
  productId: string;
  slug: string;
  url: string;
  status: "active" | "draft";
  qikinkReady: boolean;
  printFile: { widthIn: number; heightIn: number; widthPx: number; heightPx: number; dpi: number };
};

export type ValidatedPublish = { input: PublishInput; garment: Garment; printType: StudioPrintType; maxW: number; maxH: number };

const SHAPES: Record<string, GarmentShape> = { tee: "tee", oversized_tee: "oversized_tee", hoodie: "hoodie", sweatshirt: "sweatshirt" };

export function validatePublish(input: PublishInput, garment: Garment | undefined): ValidatedPublish {
  const errors: string[] = [];
  if (!input.rightsConfirmed) errors.push("Confirm you own this design or have permission to sell it.");
  if (!isStudioPath(input.sourcePath) || !isStudioPath(input.artworkPath)) errors.push("Upload and extract the design first.");
  if (!input.title?.trim() || input.title.trim().length < 3) errors.push("Give the product a name.");
  if (!garment || !garment.isActive) errors.push("Pick a garment.");
  const printType = getPrintType(input.printType);
  if (!printType) errors.push("Pick a print type.");
  if (garment && printType && !garment.printTypes.includes(printType.key)) errors.push(`${garment.name} can't take ${printType.label}.`);
  if (garment) {
    if (!input.colours?.length) errors.push("Pick at least one colour.");
    if (!input.sizes?.length) errors.push("Pick at least one size.");
    const unknownColour = input.colours?.find((c) => !garment.colours.some((gc) => gc.name === c));
    if (unknownColour) errors.push(`${unknownColour} isn't set up for ${garment.name}.`);
    const unknownSize = input.sizes?.find((s) => !garment.sizes.some((gs) => gs.size === s));
    if (unknownSize) errors.push(`Size ${unknownSize} isn't set up for ${garment.name}.`);
    if (printType?.garmentColours) {
      const bad = input.colours?.filter((c) => !printType.garmentColours!.includes(c.toLowerCase()));
      if (bad?.length) errors.push(`${printType.label} only works on ${printType.garmentColours.join("/")} garments.`);
    }
  }
  const area = printType?.maxSize[input.placement];
  if (printType && !area) errors.push(`${printType.label} isn't available on the ${PLACEMENT_LABEL[input.placement] ?? input.placement}.`);
  if (!(input.widthIn > 0.5)) errors.push("Print width must be more than half an inch.");
  if (!(input.price > 0)) errors.push("Set a price.");
  if (!["INR", "USD"].includes(input.currency)) errors.push("Currency must be INR or USD.");
  if (errors.length) throw new Error(errors.join(" "));
  return { input, garment: garment!, printType: printType!, maxW: area!.w, maxH: area!.h };
}

async function uniqueSlug(base: string): Promise<string> {
  const client = db();
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const { data } = await client.from("products").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${base}-${randomUUID().slice(0, 6)}`;
}

function variantSkuPart(slug: string): string {
  return slug.replace(/[^a-z0-9]/g, "").slice(0, 8).toUpperCase() || "DESIGN";
}

export async function publishDesign(raw: PublishInput, adminId: string | null): Promise<PublishResult> {
  const garment = await getGarment(raw.garmentKey);
  const { input, printType, maxW, maxH } = validatePublish(raw, garment);
  const g = garment!;
  const client = db();

  const { data: qikink } = await client.from("pod_providers").select("id").eq("slug", "qikink").maybeSingle();
  if (!qikink?.id) throw new Error("Qikink isn't set up as a provider.");
  const qikinkProviderId = String(qikink.id);

  const slug = await uniqueSlug(slugify(input.title));
  const designId = randomUUID();
  const productId = randomUUID();

  // 1. Print file for Qikink (same artwork for every colour and size).
  const master = await downloadFile(UPLOAD_BUCKET, input.artworkPath);
  const printFile = await renderPrintFile(master, {
    widthIn: input.widthIn,
    maxWidthIn: maxW,
    maxHeightIn: maxH,
    mode: printType.colourMode,
    flat: input.flat || printType.colourMode === "flat",
    inkHex: printType.inkHex,
  });
  const placementCode = input.placement.replace(/[^a-z]/g, "");
  const artworkPath = `studio/${slug}/${designId}-v1-${placementCode}.png`;
  await uploadFile(ARTWORK_BUCKET, artworkPath, printFile.png, "image/png");

  // 2. Mockups per colour + optional source photo for the store.
  const chosen = g.colours.filter((c) => input.colours.includes(c.name));
  const mockups: { colour: string; url: string }[] = [];
  for (const colour of chosen) {
    const img = await renderMockup(printFile.png, {
      shape: SHAPES[g.key] ?? "tee",
      colourHex: colour.hex,
      placement: input.placement,
      widthIn: printFile.widthIn,
      heightIn: printFile.heightIn,
    });
    const path = `products/${slug}/${slugify(colour.name)}-${input.placement}.webp`;
    await uploadFile(MEDIA_BUCKET, path, img, "image/webp");
    mockups.push({ colour: colour.name, url: publicUrl(MEDIA_BUCKET, path) });
  }
  let photoUrl: string | undefined;
  if (input.useSourcePhoto) {
    const photo = await toStoreImage(await downloadFile(UPLOAD_BUCKET, input.sourcePath));
    const path = `products/${slug}/photo.webp`;
    await uploadFile(MEDIA_BUCKET, path, photo, "image/webp");
    photoUrl = publicUrl(MEDIA_BUCKET, path);
  }

  const gallery = [
    ...(photoUrl ? [{ src: photoUrl, alt: `${input.title} — worn`, caption: "Worn" }] : []),
    ...mockups.map((m) => ({ src: m.url, alt: `${input.title} — ${m.colour}`, caption: m.colour, colour: m.colour })),
  ];
  const pricePaise = Math.round(input.price * 100);
  const now = new Date().toISOString();
  const qikinkStatus = g.skuConfirmed ? "verified" : "mapped";
  const widthMm = Math.max(1, Math.round(printFile.widthIn * 25.4));
  const heightMm = Math.max(1, Math.round(printFile.heightIn * 25.4));

  const cleanup = async () => {
    await client.from("provider_products").delete().eq("product_id", productId);
    await client.from("products").delete().eq("id", productId);
    await client.from("designs").delete().eq("id", designId);
  };

  try {
    // 3. Design
    const { error: dErr } = await client.from("designs").insert({
      id: designId,
      title: `${input.title} — ${PLACEMENT_LABEL[input.placement]}`,
      slug: `${slug}-${placementCode}`,
      asset_url: artworkPath,
      storage_path: artworkPath,
      status: "active",
      mime_type: "image/png",
      original_filename: `${slug}.png`,
      file_size_bytes: printFile.png.length,
      width_px: printFile.widthPx,
      height_px: printFile.heightPx,
      is_transparent: true,
      tags: ["studio", printType.key],
      notes: `Made in Studio · ${printType.label} · ${printFile.widthIn}×${printFile.heightIn} in @ ${printFile.dpi} DPI · rights confirmed by admin ${adminId ?? "system"} on ${now}`,
      version: 1,
    });
    if (dErr) throw new Error(`Design: ${dErr.message}`);

    // 4. Product
    const { error: pErr } = await client.from("products").insert({
      id: productId,
      slug,
      title: input.title.trim(),
      description: input.description.trim(),
      subtitle: `${g.name} · ${printType.label}`,
      status: input.status,
      base_price_paise: pricePaise,
      currency: input.currency,
      category: g.key,
      gender: "unisex",
      is_featured: false,
      published_at: input.status === "active" ? now : null,
      primary_image_url: gallery[0]?.src ?? null,
      gallery_json: gallery,
      studio_json: {
        garmentKey: g.key,
        garmentName: g.name,
        printType: printType.key,
        printLabel: printType.label,
        placement: input.placement,
        widthIn: printFile.widthIn,
        heightIn: printFile.heightIn,
        palette: input.palette ?? [],
        hasPhoto: Boolean(photoUrl),
        rightsConfirmedAt: now,
        rightsConfirmedBy: adminId,
      },
    });
    if (pErr) throw new Error(`Product: ${pErr.message}`);

    // 5. Variants (colour × size) — print on demand, so stock is effectively unlimited.
    const variantRows = chosen.flatMap((colour, ci) =>
      g.sizes
        .filter((s) => input.sizes.includes(s.size))
        .map((size, si) => {
          const cost = estimateCostInr(g, colour.name, [{ printType: printType.key, widthIn: printFile.widthIn, heightIn: printFile.heightIn }]);
          return {
            id: randomUUID(),
            product_id: productId,
            sku: `AT-${variantSkuPart(slug)}${productId.slice(0, 4).toUpperCase()}-${colour.code.toUpperCase()}-${size.size}`,
            size: size.size,
            color: colour.name.toLowerCase(),
            color_display: colour.name,
            stock_quantity: 1000,
            price_paise: pricePaise,
            provider_cost_paise: Math.round((cost.total + (size.extraCostInr ?? 0)) * 100),
            availability_status: "available",
            is_active: true,
            sort_order: ci * 20 + si,
            _colour: colour,
            _size: size,
          };
        }),
    );
    const { error: vErr } = await client.from("product_variants").insert(
      variantRows.map((row) => {
        const { _colour: _c, _size: _s, ...dbRow } = row;
        void _c;
        void _s;
        return dbRow;
      }),
    );
    if (vErr) throw new Error(`Variants: ${vErr.message}`);

    // 6. Placements + approved mockups per variant
    const placementRows = variantRows.map((v) => ({
      id: randomUUID(),
      design_id: designId,
      product_id: productId,
      product_variant_id: v.id,
      position: input.placement,
      placement_location: input.placement,
      x_normalized: 0.5,
      y_normalized: input.placement === "front" || input.placement === "back" ? 0.35 : 0.3,
      scale: 1,
      rotation_deg: 0,
      width_mm: widthMm,
      height_mm: heightMm,
      print_method: printType.key,
      is_active: true,
    }));
    const { error: plErr } = await client.from("design_placements").insert(placementRows);
    if (plErr) throw new Error(`Placements: ${plErr.message}`);

    const mockupRows = variantRows.map((v, i) => ({
      product_id: productId,
      variant_id: v.id,
      design_id: designId,
      placement_id: placementRows[i]!.id,
      image_url: mockups.find((m) => m.colour === v._colour.name)?.url ?? gallery[0]!.src,
      view_type: input.placement === "back" ? "back" : "front",
      is_primary: true,
      sort_order: 0,
      status: "approved",
    }));
    const { error: mErr } = await client.from("product_mockups").insert(mockupRows);
    if (mErr) throw new Error(`Mockups: ${mErr.message}`);

    // 7. Qikink mapping — verified only once this garment's SKU codes are confirmed.
    const providerProductId = randomUUID();
    const { error: ppErr } = await client.from("provider_products").insert({
      id: providerProductId,
      provider_id: qikinkProviderId,
      product_id: productId,
      external_product_id: g.skuPrefix,
      name: g.name,
      title: `${g.name} (${g.qikinkStyle ?? g.skuPrefix})`,
      print_methods_json: [printType.key],
      printable_areas_json: [{ location: input.placement, printMethod: printType.key, maxWidthMm: Math.round(maxW * 25.4), maxHeightMm: Math.round(maxH * 25.4) }],
      mapping_status: qikinkStatus,
      verified_at: g.skuConfirmed ? now : null,
      notes: g.skuConfirmed ? "Studio: SKU pattern confirmed for this garment" : "Studio: confirm this garment's Qikink SKU codes to send orders automatically",
    });
    if (ppErr) throw new Error(`Qikink product: ${ppErr.message}`);

    const { error: pvErr } = await client.from("provider_variants").insert(
      variantRows.map((v) => {
        const sku = qikinkSku(g, v._colour, v._size);
        return {
          provider_product_id: providerProductId,
          product_variant_id: v.id,
          external_variant_id: sku,
          sku,
          external_sku: sku,
          provider_color: v._colour.name,
          provider_size: v._size.code,
          mapping_status: qikinkStatus,
          verified_at: g.skuConfirmed ? now : null,
        };
      }),
    );
    if (pvErr) throw new Error(`Qikink SKUs: ${pvErr.message}`);
  } catch (err) {
    await cleanup().catch(() => undefined);
    throw err;
  }

  return {
    productId,
    slug,
    url: `/drop/${slug}`,
    status: input.status,
    qikinkReady: g.skuConfirmed,
    printFile: { widthIn: printFile.widthIn, heightIn: printFile.heightIn, widthPx: printFile.widthPx, heightPx: printFile.heightPx, dpi: printFile.dpi },
  };
}

/** Sets one price for a product and all its sizes/colours. */
export async function setProductPrice(productId: string, price: number, currency: "INR" | "USD"): Promise<void> {
  if (!(price > 0)) throw new Error("Price must be more than zero.");
  if (!["INR", "USD"].includes(currency)) throw new Error("Currency must be INR or USD.");
  const client = db();
  const paise = Math.round(price * 100);
  const now = new Date().toISOString();
  const { error: pErr } = await client.from("products").update({ base_price_paise: paise, currency, updated_at: now }).eq("id", productId);
  if (pErr) throw new Error(pErr.message);
  const { error: vErr } = await client.from("product_variants").update({ price_paise: paise, updated_at: now }).eq("product_id", productId);
  if (vErr) throw new Error(vErr.message);
}
