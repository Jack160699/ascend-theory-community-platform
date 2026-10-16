import { DROPS } from "@/lib/data/drops";
import type { CartProduct } from "./types";

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

export function getCartProduct(slug: string): CartProduct | undefined {
  return CATALOG[slug];
}

/** First product that can be added without choosing a size. */
export function getDefaultCartProduct(): CartProduct {
  const drop = DROPS.find((d) => !d.sizes?.length) ?? DROPS[0]!;
  return CATALOG[drop.slug]!;
}
