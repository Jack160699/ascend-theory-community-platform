import type {
  Product,
  ProductVariant,
  ProductValidationResult,
} from "./types";

/**
 * Calculates estimated gross margin in paise: retail price - provider cost.
 */
export function calculateGrossMarginPaise(pricePaise: number, providerCostPaise: number): number {
  return Math.max(0, pricePaise - providerCostPaise);
}

/**
 * Calculates estimated percentage gross margin.
 */
export function calculateMarginPercentage(pricePaise: number, providerCostPaise: number): number {
  if (pricePaise <= 0) return 0;
  const marginPaise = pricePaise - providerCostPaise;
  return Math.round((marginPaise / pricePaise) * 100);
}

/**
 * Validates product publish-readiness before transitioning to 'active' status.
 * Requires: title, slug, description, image, at least 1 active variant with price > 0 and unique SKU.
 */
export function validateProductPublishReadiness(
  product: Partial<Product>,
  variants: ProductVariant[] = []
): ProductValidationResult {
  const errors: string[] = [];

  if (!product.title || !product.title.trim()) {
    errors.push("Product title is required");
  }

  if (!product.slug || !product.slug.trim()) {
    errors.push("Product slug is required");
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug)) {
    errors.push("Product slug must contain lowercase alphanumeric characters and hyphens only");
  }

  if (!product.description || !product.description.trim()) {
    errors.push("Product description is required");
  }

  const hasPrimaryImage = Boolean(product.primaryImageUrl && product.primaryImageUrl.trim());
  const hasGalleryImage = Boolean(product.galleryJson && product.galleryJson.length > 0 && product.galleryJson[0]?.src);
  if (!hasPrimaryImage && !hasGalleryImage) {
    errors.push("At least one product image is required for publishing");
  }

  const activeVariants = variants.filter((v) => v.isActive && v.availabilityStatus === "available");
  if (activeVariants.length === 0) {
    errors.push("At least one active and available variant is required to publish");
  }

  const skus = new Set<string>();
  for (const variant of variants) {
    if (!variant.sku || !variant.sku.trim()) {
      errors.push(`Variant size ${variant.size} color ${variant.color} is missing a SKU`);
    } else {
      const normalizedSku = variant.sku.trim().toUpperCase();
      if (skus.has(normalizedSku)) {
        errors.push(`Duplicate SKU '${variant.sku}' detected among product variants`);
      }
      skus.add(normalizedSku);
    }

    if (variant.pricePaise <= 0) {
      errors.push(`Variant SKU '${variant.sku}' must have a retail price greater than 0`);
    }

    if (variant.providerCostPaise < 0) {
      errors.push(`Variant SKU '${variant.sku}' provider cost cannot be negative`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
