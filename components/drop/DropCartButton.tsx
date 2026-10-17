"use client";

import { useDropProduct } from "@/components/drop/DropProductContext";
import { useCart } from "@/contexts/cart";
import { cn } from "@/lib/utils";
import { useCallback, useId, useMemo, useState } from "react";
import type { PublicProductVariant } from "@/lib/wearables/types";

type DropCartButtonProps = {
  className?: string;
  variant?: "primary" | "ghost";
  label?: string;
};

/**
 * Inner selector component keyed by product identity.
 * Keying ensures state (selectedVariantId) initializes cleanly on mount
 * when product changes, with zero render-phase state mutations or effects.
 */
function VariantSelector({
  className,
  variant = "primary",
  label = "Add to Cart",
}: DropCartButtonProps) {
  const product = useDropProduct();
  const { addProduct } = useCart();
  const [pending, setPending] = useState(false);
  const labelId = useId();

  // All active+available variants for this product
  const availableVariants = useMemo(
    () => (product.variants || []).filter((v) => v.isActive && v.availabilityStatus === "available"),
    [product.variants],
  );

  // Derive deduplicated color list (preserving first-occurrence order)
  const allColors = useMemo<{ key: string; display: string }[]>(() => {
    const seen = new Set<string>();
    const out: { key: string; display: string }[] = [];
    for (const v of availableVariants) {
      if (!seen.has(v.color)) {
        seen.add(v.color);
        out.push({ key: v.color, display: v.colorDisplay || v.color });
      }
    }
    return out;
  }, [availableVariants]);

  // Derive deduplicated size list (preserving first-occurrence order)
  const allSizes = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of availableVariants) {
      if (!seen.has(v.size)) {
        seen.add(v.size);
        out.push(v.size);
      }
    }
    return out;
  }, [availableVariants]);

  /**
   * SINGLE SOURCE OF TRUTH: selectedVariantId
   * Derived color/size are just display projections of the selected variant.
   * Eliminates render-phase setState and disjoint-selection deadlock.
   */
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    () => availableVariants[0]?.id ?? "",
  );

  // Resolve the selected variant object from ID
  const selectedVariant = useMemo(
    (): PublicProductVariant | undefined =>
      availableVariants.find((v) => v.id === selectedVariantId),
    [availableVariants, selectedVariantId],
  );

  // Derive current selections from the selected variant (display projections only)
  const selectedColor = selectedVariant?.color ?? "";
  const selectedSize = selectedVariant?.size ?? "";

  /**
   * Colors that have at least one available variant — always all colors.
   * A color is ALWAYS selectable (it just snaps the size to a valid one).
   */
  const selectColor = useCallback(
    (color: string) => {
      // Find first variant that matches this color (any size)
      const first = availableVariants.find((v) => v.color === color);
      if (!first) return;

      // If current size works with the new color, keep it; otherwise take first valid size
      const sameColorSameSize = availableVariants.find(
        (v) => v.color === color && v.size === selectedSize,
      );
      setSelectedVariantId(sameColorSameSize?.id ?? first.id);
    },
    [availableVariants, selectedSize],
  );

  /**
   * Sizes that have at least one available variant for the CURRENT selected color.
   */
  const sizesForCurrentColor = useMemo<string[]>(() => {
    if (!selectedColor) return allSizes;
    const set = new Set<string>();
    availableVariants.filter((v) => v.color === selectedColor).forEach((v) => set.add(v.size));
    return allSizes.filter((s) => set.has(s));
  }, [availableVariants, selectedColor, allSizes]);

  const selectSize = useCallback(
    (size: string) => {
      // Prefer same-color + new-size; fallback to first variant with this size
      const sameColorNewSize = availableVariants.find(
        (v) => v.size === size && v.color === selectedColor,
      );
      const anyVariantWithSize = availableVariants.find((v) => v.size === size);
      const target = sameColorNewSize ?? anyVariantWithSize;
      if (target) setSelectedVariantId(target.id);
    },
    [availableVariants, selectedColor],
  );

  const handleClick = useCallback(() => {
    if (pending || !selectedVariant) return;
    setPending(true);

    const priceAmount = selectedVariant.pricePaise / 100;
    const currencyCode = product.price.currency || "INR";
    const priceDisplay = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(priceAmount);

    addProduct({
      slug: product.slug,
      variantId: selectedVariant.id,
      sku: selectedVariant.sku,
      size: selectedVariant.size,
      color: selectedVariant.color,
      quantity: 1,
      title: product.name,
      image: product.hero.image,
      priceDisplay,
      currency: currencyCode,
      pricePaise: selectedVariant.pricePaise,
    });

    window.setTimeout(() => setPending(false), 400);
  }, [addProduct, pending, product, selectedVariant]);

  if (availableVariants.length === 0) {
    return (
      <button type="button" disabled className={cn("drop-cta", className)}>
        Out of Stock
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="sr-only">
        {product.name} variant selector
      </span>

      {/* Color Selector */}
      {allColors.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono uppercase text-white/50">Color:</span>
          <div className="flex gap-1.5 flex-wrap">
            {allColors.map(({ key, display }) => {
              const isSelected = selectedColor === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectColor(key)}
                  aria-pressed={isSelected}
                  className={cn(
                    "px-2.5 py-1 text-xs font-mono rounded border transition",
                    isSelected
                      ? "bg-white text-black border-white font-medium"
                      : "bg-black/40 text-white border-white/20 hover:border-white/50",
                  )}
                >
                  {display}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Size Selector */}
      {allSizes.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono uppercase text-white/50">Size:</span>
          <div className="flex gap-1.5 flex-wrap">
            {allSizes.map((sz) => {
              const isAvailableForColor = sizesForCurrentColor.includes(sz);
              const isSelected = selectedSize === sz;
              return (
                <button
                  key={sz}
                  type="button"
                  disabled={!isAvailableForColor}
                  onClick={() => selectSize(sz)}
                  aria-pressed={isSelected}
                  className={cn(
                    "px-2.5 py-1 text-xs font-mono rounded border transition",
                    isSelected
                      ? "bg-white text-black border-white font-medium"
                      : isAvailableForColor
                        ? "bg-black/40 text-white border-white/20 hover:border-white/50"
                        : "bg-black/20 text-white/20 border-white/5 cursor-not-allowed line-through",
                  )}
                >
                  {sz}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleClick}
        disabled={pending || !selectedVariant}
        className={cn(
          "drop-cta",
          variant === "ghost" && "drop-cta--ghost",
          className,
        )}
      >
        {pending ? "Added" : !selectedVariant ? "Select a variant" : label}
      </button>
    </div>
  );
}

export function DropCartButton(props: DropCartButtonProps) {
  const product = useDropProduct();
  return <VariantSelector key={product.slug || product.name} {...props} />;
}
