/**
 * Phase 5 — Design Studio & POD Mapping Core Types
 */

export type DesignStatus = "draft" | "active" | "archived";

export type PlacementLocation =
  | "front"
  | "back"
  | "left_chest"
  | "right_chest"
  | "left_sleeve"
  | "right_sleeve"
  | "neck"
  | "custom";

export type PrintMethod =
  | "dtf"
  | "dtg"
  | "screen_print"
  | "embroidery"
  | "sublimation"
  | "other";

export type MappingStatus =
  | "unmapped"
  | "draft"
  | "mapped"
  | "verified"
  | "disabled";

export type MockupViewType = "front" | "back" | "detail" | "lifestyle";
export type MockupStatus = "draft" | "approved" | "rejected";

export type DesignAsset = {
  id: string;
  title: string;
  slug: string;
  description?: string;
  status: DesignStatus;
  assetUrl: string;
  storagePath?: string;
  previewUrl?: string;
  mimeType?: string;
  originalFilename?: string;
  fileSizeBytes?: number;
  checksum?: string;
  widthPx?: number;
  heightPx?: number;
  isTransparent?: boolean;
  designer?: string;
  tags?: string[];
  notes?: string;
  version?: number;
  createdAt: string;
  updatedAt: string;
  placements?: DesignPlacement[];
};

export type DesignPlacement = {
  id: string;
  designId: string;
  productId?: string;
  productVariantId?: string;
  position: string;
  placementLocation: PlacementLocation;
  xNormalized: number; // 0.0000 - 1.0000
  yNormalized: number; // 0.0000 - 1.0000
  scale: number;       // > 0
  rotationDeg: number; // -360 to 360
  widthMm: number;     // > 0
  heightMm: number;    // > 0
  printMethod: PrintMethod;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PODProvider = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
};

export type PrintableAreaSpec = {
  location: PlacementLocation;
  maxWidthMm: number;
  maxHeightMm: number;
  printMethod: PrintMethod;
};

export type ProviderProduct = {
  id: string;
  providerId: string;
  productId?: string;
  externalProductId: string;
  name: string;
  title?: string;
  printMethodsJson?: PrintMethod[];
  printableAreasJson?: PrintableAreaSpec[];
  mappingStatus: MappingStatus;
  notes?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  createdAt: string;
  updatedAt: string;
  variants?: ProviderVariant[];
};

export type ProviderVariant = {
  id: string;
  providerProductId: string;
  productVariantId?: string;
  externalVariantId: string;
  externalSku?: string;
  sku: string;
  providerColor?: string;
  providerSize?: string;
  mappingStatus: MappingStatus;
  notes?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductMockup = {
  id: string;
  productId: string;
  variantId?: string;
  designId?: string;
  placementId?: string;
  imageUrl: string;
  viewType: MockupViewType;
  isPrimary: boolean;
  sortOrder: number;
  status: MockupStatus;
  createdAt: string;
  updatedAt: string;
};

export type PublicProductMockup = {
  imageUrl: string;
  viewType: MockupViewType;
  isPrimary: boolean;
  sortOrder: number;
  variantId?: string;
};

export type ReadinessBlockingReason =
  | "draft_product"
  | "inactive_variant"
  | "unavailable_variant"
  | "missing_design"
  | "draft_design"
  | "archived_design"
  | "missing_artwork"
  | "invalid_placement_dimensions"
  | "invalid_placement_coordinates"
  | "print_exceeds_provider_area"
  | "unsupported_provider_placement"
  | "unsupported_provider_print_method"
  | "missing_provider"
  | "missing_provider_product_mapping"
  | "missing_provider_variant_mapping"
  | "unverified_provider_product_mapping"
  | "unverified_provider_variant_mapping"
  | "disabled_provider_mapping"
  | "no_approved_primary_mockup";

export type ProviderReadiness = {
  providerId: string;
  providerSlug: string;
  providerName: string;
  ready: boolean;
  reasons: ReadinessBlockingReason[];
};

export type VariantReadiness = {
  variantId: string;
  sku: string;
  size: string;
  color: string;
  readyForFulfillment: boolean;
  checks: {
    productPublished: boolean;
    variantActive: boolean;
    variantAvailable: boolean;
    designAssigned: boolean;
    placementValid: boolean;
    artworkPresent: boolean;
    providerSelected: boolean;
    providerProductMapped: boolean;
    providerVariantMapped: boolean;
    mockupReady: boolean;
  };
  providerReadiness?: ProviderReadiness[];
  blockingReasons: ReadinessBlockingReason[];
};

export type ProductReadinessReport = {
  productId: string;
  slug: string;
  title: string;
  productPublished: boolean;
  overallReady: boolean;
  readyVariantCount: number;
  totalVariantCount: number;
  variants: VariantReadiness[];
};
