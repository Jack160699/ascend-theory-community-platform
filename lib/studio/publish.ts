/**
 * Publish: one call turns cleaned artwork into a sellable product —
 * Qikink print file (300 DPI), mockups per fit × colour, product, fit × colour × size variants,
 * design + placements, approved mockups and Qikink SKU mappings (one Qikink product per fit).
 */

import { randomUUID } from "node:crypto";
import type { PlacementLocation, PrintMethod } from "@/lib/wearables/design-types";
import { estimateCostInr, fitDetail, fitLabel, listGarments, qikinkSku, type Garment } from "./garments";
import { renderMockup, renderPrintFile, toStoreImage } from "./image";
import { shapeForGarment } from "./mockup-svg";
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
  /**
   * Sell the same design on several garments, each at its own price. The first fit is the main one
   * (garmentKey/price above are kept for older callers and mean a single fit).
   */
  fits?: { garmentKey: string; price: number }[];
};

/** One garment the product is sold on, with the colours/sizes it actually has. */
export type FitPlan = {
  garment: Garment;
  label: string;
  detail: string;
  price: number;
  colours: Garment["colours"];
  sizes: Garment["sizes"];
};

export type FitInfo = { key: string; label: string; detail: string; name: string; price: number };

export type PublishResult = {
  productId: string;
  slug: string;
  url: string;
  status: "active" | "draft";
  qikinkReady: boolean;
  printFile: { widthIn: number; heightIn: number; widthPx: number; heightPx: number; dpi: number };
};

export type ValidatedPublish = { input: PublishInput; garment: Garment; printType: StudioPrintType; maxW: number; maxH: number };

/**
 * Works out every fit to publish: the main garment plus any extra fits, each limited to the chosen
 * colours and sizes it has. Throws a readable error if a fit can't take the print or has nothing to sell.
 */
export function planFits(input: PublishInput, garments: Garment[], printType: StudioPrintType): FitPlan[] {
  const requested = input.fits?.length ? input.fits : [{ garmentKey: input.garmentKey, price: input.price }];
  const seen = new Set<string>();
  const errors: string[] = [];
  const plans: FitPlan[] = [];
  for (const f of requested) {
    if (seen.has(f.garmentKey)) continue;
    seen.add(f.garmentKey);
    const g = garments.find((x) => x.key === f.garmentKey);
    if (!g || !g.isActive) {
      errors.push(`Fit "${f.garmentKey}" isn't an active garment.`);
      continue;
    }
    if (!g.printTypes.includes(printType.key)) {
      errors.push(`${g.name} can't take ${printType.label}.`);
      continue;
    }
    const colours = g.colours.filter(
      (c) => input.colours.includes(c.name) && (!printType.garmentColours || printType.garmentColours.includes(c.name.toLowerCase())),
    );
    const sizes = g.sizes.filter((sz) => input.sizes.includes(sz.size));
    if (!colours.length || !sizes.length) {
      errors.push(`${g.name} doesn't come in the colours/sizes you picked.`);
      continue;
    }
    const price = Number(f.price);
    if (!(price > 0)) {
      errors.push(`Set a price for ${fitLabel(g)}.`);
      continue;
    }
    plans.push({ garment: g, label: fitLabel(g), detail: fitDetail(g), price, colours, sizes });
  }
  if (errors.length) throw new Error(errors.join(" "));
  if (!plans.length) throw new Error("Pick at least one fit.");
  return plans;
}

/** Variant SKU on our side: product part, fit code (when several fits), colour, size. */
export function variantSku(slug: string, productId: string, fitCode: string | null, colourCode: string, size: string): string {
  const base = `AT-${variantSkuPart(slug)}${productId.slice(0, 4).toUpperCase()}`;
  return [base, fitCode, colourCode.toUpperCase(), size].filter(Boolean).join("-");
}


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
  const garments = await listGarments();
  const mainKey = raw.fits?.[0]?.garmentKey ?? raw.garmentKey;
  const mainPrice = raw.fits?.[0]?.price ?? raw.price;
  const { input, printType, maxW, maxH } = validatePublish({ ...raw, garmentKey: mainKey, price: mainPrice }, garments.find((g) => g.key === mainKey));
  const fits = planFits(input, garments, printType);
  const multi = fits.length > 1;
  const client = db();

  const { data: qikink } = await client.from("pod_providers").select("id").eq("slug", "qikink").maybeSingle();
  if (!qikink?.id) throw new Error("Qikink isn't set up as a provider.");
  const qikinkProviderId = String(qikink.id);

  const slug = await uniqueSlug(slugify(input.title));
  const designId = randomUUID();
  const productId = randomUUID();

  // 1. Print file for Qikink (same artwork for every fit, colour and size).
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

  // 2. Mockups per fit × colour + optional source photo for the store.
  const mockups: { fit: string; colour: string; url: string }[] = [];
  for (const fit of fits) {
    for (const colour of fit.colours) {
      const img = await renderMockup(printFile.png, {
        shape: shapeForGarment(fit.garment.key),
        colourHex: colour.hex,
        placement: input.placement,
        widthIn: printFile.widthIn,
        heightIn: printFile.heightIn,
      });
      const path = `products/${slug}/${multi ? `${fit.garment.key}-` : ""}${slugify(colour.name)}-${input.placement}.webp`;
      await uploadFile(MEDIA_BUCKET, path, img, "image/webp");
      mockups.push({ fit: fit.garment.key, colour: colour.name, url: publicUrl(MEDIA_BUCKET, path) });
    }
  }
  let photoUrl: string | undefined;
  if (input.useSourcePhoto) {
    const photo = await toStoreImage(await downloadFile(UPLOAD_BUCKET, input.sourcePath));
    const path = `products/${slug}/photo.webp`;
    await uploadFile(MEDIA_BUCKET, path, photo, "image/webp");
    photoUrl = publicUrl(MEDIA_BUCKET, path);
  }

  const labelOf = (key: string) => fits.find((f) => f.garment.key === key)!.label;
  const gallery = [
    ...(photoUrl ? [{ src: photoUrl, alt: `${input.title} — worn`, caption: "Worn" }] : []),
    ...mockups.map((m) => ({
      src: m.url,
      alt: `${input.title} — ${multi ? `${labelOf(m.fit)}, ` : ""}${m.colour}`,
      caption: multi ? `${labelOf(m.fit)} · ${m.colour}` : m.colour,
      colour: m.colour,
      ...(multi ? { fit: m.fit } : {}),
    })),
  ];
  const fromPrice = Math.min(...fits.map((f) => f.price));
  const now = new Date().toISOString();
  const widthMm = Math.max(1, Math.round(printFile.widthIn * 25.4));
  const heightMm = Math.max(1, Math.round(printFile.heightIn * 25.4));
  const fitInfo: FitInfo[] = fits.map((f) => ({ key: f.garment.key, label: f.label, detail: f.detail, name: f.garment.name, price: f.price }));
  const main = fits[0]!.garment;

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
      subtitle: multi ? `${fits.length} fits · ${printType.label}` : `${main.name} · ${printType.label}`,
      status: input.status,
      base_price_paise: Math.round(fromPrice * 100),
      currency: input.currency,
      category: main.key,
      gender: "unisex",
      is_featured: false,
      published_at: input.status === "active" ? now : null,
      primary_image_url: gallery[0]?.src ?? null,
      gallery_json: gallery,
      studio_json: {
        garmentKey: main.key,
        garmentName: main.name,
        fits: fitInfo,
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

    // 5. Variants (fit × colour × size) — print on demand, so stock is effectively unlimited.
    const variantRows = fits.flatMap((fit, fi) =>
      fit.colours.flatMap((colour, ci) =>
        fit.sizes.map((size, si) => {
          const g = fit.garment;
          const cost = estimateCostInr(g, colour.name, [{ printType: printType.key, widthIn: printFile.widthIn, heightIn: printFile.heightIn }]);
          return {
            id: randomUUID(),
            product_id: productId,
            sku: variantSku(slug, productId, multi ? (g.qikinkStyle ?? g.key).replace(/[^A-Za-z0-9]/g, "").toUpperCase() : null, colour.code, size.size),
            size: size.size,
            color: colour.name.toLowerCase(),
            color_display: colour.name,
            style: g.key,
            style_label: fit.label,
            stock_quantity: 1000,
            price_paise: Math.round(fit.price * 100),
            provider_cost_paise: Math.round((cost.total + (size.extraCostInr ?? 0)) * 100),
            availability_status: "available",
            is_active: true,
            sort_order: fi * 1000 + ci * 20 + si,
            _fit: fit,
            _colour: colour,
            _size: size,
          };
        }),
      ),
    );
    const { error: vErr } = await client.from("product_variants").insert(
      variantRows.map((row) => {
        const { _fit: _f, _colour: _c, _size: _s, ...dbRow } = row;
        void _f;
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
      image_url: mockups.find((m) => m.fit === v._fit.garment.key && m.colour === v._colour.name)?.url ?? gallery[0]!.src,
      view_type: input.placement === "back" ? "back" : "front",
      is_primary: true,
      sort_order: 0,
      status: "approved",
    }));
    const { error: mErr } = await client.from("product_mockups").insert(mockupRows);
    if (mErr) throw new Error(`Mockups: ${mErr.message}`);

    // 7. Qikink mapping, one Qikink product per fit — verified only once that garment's SKU codes are confirmed.
    for (const fit of fits) {
      const g = fit.garment;
      const status = g.skuConfirmed ? "verified" : "mapped";
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
        mapping_status: status,
        verified_at: g.skuConfirmed ? now : null,
        notes: g.skuConfirmed ? "Studio: SKU pattern confirmed for this garment" : "Studio: confirm this garment's Qikink SKU codes to send orders automatically",
      });
      if (ppErr) throw new Error(`Qikink product: ${ppErr.message}`);

      const { error: pvErr } = await client.from("provider_variants").insert(
        variantRows
          .filter((v) => v._fit === fit)
          .map((v) => {
            const sku = qikinkSku(g, v._colour, v._size);
            return {
              provider_product_id: providerProductId,
              product_variant_id: v.id,
              external_variant_id: sku,
              sku,
              external_sku: sku,
              provider_color: v._colour.name,
              provider_size: v._size.code,
              mapping_status: status,
              verified_at: g.skuConfirmed ? now : null,
            };
          }),
      );
      if (pvErr) throw new Error(`Qikink SKUs: ${pvErr.message}`);
    }
  } catch (err) {
    await cleanup().catch(() => undefined);
    throw err;
  }

  return {
    productId,
    slug,
    url: `/drop/${slug}`,
    status: input.status,
    qikinkReady: fits.every((f) => f.garment.skuConfirmed),
    printFile: { widthIn: printFile.widthIn, heightIn: printFile.heightIn, widthPx: printFile.widthPx, heightPx: printFile.heightPx, dpi: printFile.dpi },
  };
}

/**
 * Sets the product's price. With several fits, the cheapest fit gets this price and the
 * others move by the same amount, so the gaps between fits (e.g. +₹200 for terry) stay.
 */
export async function setProductPrice(productId: string, price: number, currency: "INR" | "USD"): Promise<void> {
  if (!(price > 0)) throw new Error("Price must be more than zero.");
  if (!["INR", "USD"].includes(currency)) throw new Error("Currency must be INR or USD.");
  const client = db();
  const paise = Math.round(price * 100);
  const now = new Date().toISOString();
  const { data: variants, error: readErr } = await client.from("product_variants").select("id, price_paise, style").eq("product_id", productId);
  if (readErr) throw new Error(readErr.message);
  const rows = (variants ?? []) as { id: string; price_paise: number; style: string | null }[];
  const floor = rows.length ? Math.min(...rows.map((v) => Number(v.price_paise))) : paise;
  const delta = paise - floor;
  const { error: pErr } = await client.from("products").update({ base_price_paise: paise, currency, updated_at: now }).eq("id", productId);
  if (pErr) throw new Error(pErr.message);
  const byPrice = new Map<number, string[]>();
  for (const v of rows) {
    const next = Math.max(100, Number(v.price_paise) + delta);
    byPrice.set(next, [...(byPrice.get(next) ?? []), v.id]);
  }
  for (const [next, ids] of byPrice) {
    const { error: vErr } = await client.from("product_variants").update({ price_paise: next, updated_at: now }).in("id", ids);
    if (vErr) throw new Error(vErr.message);
  }
  await syncFitPrices(productId);
}

/** Keeps studio_json.fits[].price in step with the variants (the storefront reads variant prices). */
async function syncFitPrices(productId: string): Promise<void> {
  const client = db();
  const { data: product } = await client.from("products").select("studio_json").eq("id", productId).maybeSingle();
  const studio = (product?.studio_json ?? null) as { fits?: FitInfo[] } | null;
  if (!studio?.fits?.length) return;
  const { data: variants } = await client.from("product_variants").select("style, price_paise").eq("product_id", productId);
  const fits = studio.fits.map((f) => {
    const prices = (variants ?? []).filter((v) => v.style === f.key).map((v) => Number(v.price_paise));
    return prices.length ? { ...f, price: Math.min(...prices) / 100 } : f;
  });
  await client.from("products").update({ studio_json: { ...studio, fits } }).eq("id", productId);
}
