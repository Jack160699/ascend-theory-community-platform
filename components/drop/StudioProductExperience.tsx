"use client";

import { AscendImage } from "@/components/AscendImage";
import { BrandNav } from "@/components/brand/BrandNav";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import type { Drop } from "@/lib/data/drops";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useMemo, useState } from "react";
import { usePurchase } from "./PrintProductExperience";

const PLACEMENT_WORDS: Record<string, string> = {
  front: "on the front",
  back: "on the back",
  left_chest: "on the left chest",
  right_chest: "on the right chest",
  left_sleeve: "on the left shoulder",
  right_sleeve: "on the right shoulder",
};

/** Product page for designs published from the HQ studio. */
export function StudioProductExperience({ product }: { product: Drop }) {
  const studio = product.studio!;
  const purchase = usePurchase(product);
  const [picked, setPicked] = useState(0);

  const images = useMemo(() => {
    const list = studio.gallery.length ? studio.gallery : [{ src: product.image, alt: product.imageAlt }];
    return list as { src: string; alt: string; colour?: string }[];
  }, [studio.gallery, product.image, product.imageAlt]);

  // Choosing a colour shows that colour's image; otherwise the picked thumbnail.
  const colourLabel = purchase.colours.find((c) => c.key === purchase.colour)?.label;
  const colourIndex = images.findIndex((img) => img.colour && img.colour.toLowerCase() === colourLabel?.toLowerCase());
  const [lastColour, setLastColour] = useState(purchase.colour);
  if (lastColour !== purchase.colour) {
    setLastColour(purchase.colour);
    if (colourIndex >= 0) setPicked(colourIndex);
  }
  const main = images[Math.min(picked, images.length - 1)]!;

  return (
    <main className="drop-canvas min-h-screen overflow-x-clip antialiased">
      <BrandNav />
      <div className="drop-shell grid gap-10 pb-24 pt-24 sm:pt-28 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <section aria-label="Images" className="space-y-3">
          <div className="relative aspect-[5/6] w-full overflow-hidden rounded-sm bg-white/[0.03]">
            <AscendImage src={main.src} alt={main.alt} fill priority sizes="(min-width: 1024px) 55vw, 100vw" className="object-cover" />
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-2">
              {images.map((img, i) => (
                <button
                  key={img.src}
                  type="button"
                  onClick={() => setPicked(i)}
                  aria-label={`Show image ${i + 1}`}
                  className={cn("relative aspect-square overflow-hidden rounded-sm border", i === picked ? "border-white/70" : "border-white/10 hover:border-white/30")}
                >
                  <AscendImage src={img.src} alt={img.alt} fill sizes="120px" className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section id="buy" aria-label="Buy" className="lg:sticky lg:top-24 lg:self-start">
          <p className="brand-eyebrow">
            {studio.garmentName} · {studio.printLabel}
          </p>
          <h1 className="brand-headline mt-3">{product.name}</h1>
          <p className="mt-4 text-2xl font-medium tabular-nums text-white">{product.price.display}</p>

          {purchase.colours.length > 1 && (
            <div className="mt-8">
              <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">Colour · {colourLabel}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {purchase.colours.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => purchase.pickColour(c.key)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-xs tracking-wide transition",
                      c.key === purchase.colour ? "border-white text-white" : "border-white/20 text-white/60 hover:border-white/50",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {purchase.allSizes.length > 0 && (
            <div className="mt-8">
              <p className={cn("text-[11px] uppercase tracking-[0.2em]", purchase.needsSize ? "text-rose-300" : "text-white/50")}>
                {purchase.needsSize ? "Choose your size" : "Size"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {purchase.allSizes.map((s) => {
                  const available = purchase.sizesInColour.has(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={!available}
                      onClick={() => purchase.pick(s)}
                      className={cn(
                        "min-w-12 rounded-sm border px-3 py-2.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-30",
                        s === purchase.size ? "border-white bg-white text-black" : "border-white/20 text-white/80 hover:border-white/60",
                      )}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {purchase.soldOut ? (
              <button type="button" className="drop-cta" disabled>
                Sold out
              </button>
            ) : (
              <>
                <button type="button" className="drop-cta flex-1" onClick={purchase.buyNow}>
                  Buy now · {product.price.display}
                </button>
                <button type="button" className="drop-cta drop-cta--ghost flex-1" onClick={purchase.addToCart}>
                  {purchase.added ? "Added to cart" : "Add to cart"}
                </button>
              </>
            )}
          </div>

          {product.description && <p className="brand-body mt-10 max-w-prose text-white/70">{product.description}</p>}

          <ul className="mt-8 space-y-2 border-t border-white/10 pt-6 text-sm text-white/60">
            <li>
              {studio.printLabel} {PLACEMENT_WORDS[studio.placement] ?? ""}
            </li>
            <li>{studio.garmentName}, unisex fit</li>
            <li>Made to order — printed for you when you order</li>
            <li>
              <Link href={BRAND_ROUTES.drops} className="underline-offset-4 hover:text-white hover:underline">
                See all drops
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
