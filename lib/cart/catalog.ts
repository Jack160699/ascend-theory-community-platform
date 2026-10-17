import { DROPS } from "@/lib/data/drops";
import type { CartLine, CartProduct } from "./types";

/**
 * Static catalogue ONLY used for local dev/testing without Supabase.
 * Production uses the display snapshot embedded in CartLine itself.
 */
const CATALOG: Record<string, CartProduct> = Object.fromEntries(
  DROPS.map((drop) => [
    drop.slug,
    {
      slug: drop.slug,
      name: drop.name,
      dropName: drop.dropName,
      image: drop.hero.image,
      imageAlt: drop.hero.alt,
      price: drop.price.amount,
      currency: drop.price.currency,
      priceDisplay: drop.price.display,
      maxQuantity: drop.scarcity.stockRemaining,
      sizes: drop.sizes,
    },
  ]),
);

/**
 * Builds a CartProduct for UI display.
 * Prefers snapshot data embedded in CartLine (for DB-backed products),
 * falls back to static CATALOG for local dev compatibility.
 */
export function getCartProductFromLine(line: CartLine): CartProduct | undefined {
  // Use snapshot from CartLine if available (DB-backed flow)
  if (line.title && line.image) {
    return {
      slug: line.slug,
      name: line.title,
      dropName: "",
      image: line.image,
      imageAlt: line.title,
      price: line.pricePaise ? line.pricePaise / 100 : 0,
      currency: line.currency ?? "INR",
      priceDisplay: line.priceDisplay ?? "",
      maxQuantity: 50,
    };
  }
  // Static catalogue fallback for local dev
  return CATALOG[line.slug];
}

/** @deprecated Use getCartProductFromLine(line) for DB-backed products. */
export function getCartProduct(slug: string): CartProduct | undefined {
  return CATALOG[slug];
}

/** First product that can be added without choosing a size. */
export function getDefaultCartProduct(): CartProduct {
  const drop = DROPS.find((d) => !d.sizes?.length) ?? DROPS[0]!;
  return CATALOG[drop.slug]!;
}
