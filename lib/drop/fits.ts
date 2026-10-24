/**
 * Fits on the product page: a studio product can be sold on several garments
 * (classic crew, heavyweight, terry oversized…). Pure helpers so the page and tests agree.
 */

export type FitVariant = { style?: string; styleLabel?: string; color: string; size: string; pricePaise: number };
export type StudioFit = { key: string; label: string; detail: string; price: number };
export type FitOption = { key: string; label: string; detail: string; pricePaise: number };

/** Fits in variant order, each with its lowest price. Empty when the product has a single garment. */
export function fitOptions(variants: FitVariant[], studioFits: StudioFit[] = []): FitOption[] {
  const out = new Map<string, FitOption>();
  for (const v of variants) {
    if (!v.style) continue;
    const known = studioFits.find((f) => f.key === v.style);
    const prev = out.get(v.style);
    if (!prev) {
      out.set(v.style, { key: v.style, label: v.styleLabel || known?.label || v.style, detail: known?.detail ?? "", pricePaise: v.pricePaise });
    } else if (v.pricePaise < prev.pricePaise) {
      prev.pricePaise = v.pricePaise;
    }
  }
  return out.size > 1 ? [...out.values()] : [];
}

/** Variants of one fit (all variants when the product has no fits). */
export function inFit<T extends FitVariant>(variants: T[], fit: string | null): T[] {
  return fit ? variants.filter((v) => v.style === fit) : variants;
}

/** Gallery image for a fit + colour: exact match, then same colour, then same fit. */
export function imageIndexFor(images: { colour?: string; fit?: string }[], fit: string | null, colourLabel: string | undefined): number {
  const c = colourLabel?.toLowerCase();
  const sameColour = (img: { colour?: string }) => Boolean(img.colour && img.colour.toLowerCase() === c);
  let i = fit ? images.findIndex((img) => img.fit === fit && sameColour(img)) : -1;
  if (i < 0) i = images.findIndex((img) => sameColour(img) && (!fit || !img.fit));
  if (i < 0 && fit) i = images.findIndex((img) => img.fit === fit);
  return i;
}
