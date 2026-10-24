export type ProductStatus = "draft" | "active" | "archived";
export type CollectionStatus = "draft" | "published" | "archived";
export type VariantAvailability = "available" | "unavailable" | "sample_only" | "returned_inventory_only";

export type ProductVariant = {
  id: string;
  productId: string;
  sku: string;
  size: string;
  color: string;
  colorDisplay?: string;
  /** Garment this variant is made on, when the product is sold in several fits (pod_garments.key). */
  style?: string;
  /** Customer-facing fit name, e.g. "Terry oversized". */
  styleLabel?: string;
  stockQuantity: number;
  pricePaise: number;
  compareAtPricePaise?: number;
  providerCostPaise: number;
  availabilityStatus: VariantAvailability;
  isActive: boolean;
  weightGrams?: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicProductVariant = Omit<ProductVariant, "providerCostPaise">;

export type Collection = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  story?: string;
  status: CollectionStatus;
  startDate?: string;
  endDate?: string;
  heroImageUrl?: string;
  mediaJson?: Record<string, unknown>[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type StudioProductInfo = {
  garmentKey: string;
  garmentName: string;
  printType: string;
  printLabel: string;
  placement: string;
  widthIn?: number;
  heightIn?: number;
  palette?: string[];
  hasPhoto?: boolean;
  /** Fits this design is sold in (first = main), with fabric/cut line and starting price. */
  fits?: { key: string; label: string; detail: string; name: string; price: number }[];
};

export type Product = {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  status: ProductStatus;
  basePricePaise: number;
  currency: string;
  materials?: string;
  category: string;
  collectionId?: string | null;
  gender: string;
  isFeatured: boolean;
  publishedAt?: string | null;
  seoTitle?: string;
  seoDescription?: string;
  primaryImageUrl?: string;
  galleryJson: { src: string; alt?: string; caption?: string; colour?: string; fit?: string }[];
  sizeChartJson?: Record<string, unknown>;
  /** Set for products made in the HQ studio (garment, print type, placement). */
  studioJson?: StudioProductInfo | null;
  createdAt: string;
  updatedAt: string;
  variants?: ProductVariant[];
  collection?: Collection;
};

import type { PublicProductMockup } from "./design-types";

export type PublicProduct = Omit<Product, "variants"> & {
  variants: PublicProductVariant[];
  mockups?: PublicProductMockup[];
};

export type ProductValidationResult = {
  isValid: boolean;
  errors: string[];
};

export type WearablesOverviewStats = {
  publishedProductsCount: number;
  draftProductsCount: number;
  activeVariantsCount: number;
  collectionsCount: number;
  productsMissingVariantsCount: number;
  productsMissingImageryCount: number;
  productsMissingProviderMappingCount: number;
};
