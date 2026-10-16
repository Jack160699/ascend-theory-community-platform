/**
 * Phase 5 — Server-Side Fulfilment Readiness Engine
 * Evaluates whether an Ascend product / variant is ready for POD manufacturing fulfillment.
 */

import type { Product, ProductVariant } from "./types";
import type {
  DesignAsset,
  DesignPlacement,
  PODProvider,
  ProviderProduct,
  ProviderVariant,
  ProductMockup,
  VariantReadiness,
  ProviderReadiness,
  ProductReadinessReport,
  ReadinessBlockingReason,
  PrintableAreaSpec,
  PrintMethod,
} from "./design-types";
import { validateDesignPlacement } from "./placement-validator";

export function evaluateVariantReadiness(input: {
  product: Product;
  variant: ProductVariant;
  design?: DesignAsset | null;
  placement?: DesignPlacement | null;
  placements?: DesignPlacement[];
  designsMap?: Map<string, DesignAsset>;
  providers?: PODProvider[];
  providerProduct?: ProviderProduct | null;
  providerVariant?: ProviderVariant | null;
  providerMappings?: Array<{
    provider: PODProvider;
    productVariantId?: string;
    providerProduct?: ProviderProduct | null;
    providerVariant?: ProviderVariant | null;
  }>;
  mockups?: ProductMockup[];
}): VariantReadiness {
  const {
    product,
    variant,
    design,
    placement,
    placements,
    designsMap = new Map(),
    providers = [],
    providerProduct,
    providerVariant,
    providerMappings,
    mockups = [],
  } = input;

  const baseReasons: ReadinessBlockingReason[] = [];

  // 1. Product published check
  const productPublished = product.status === "active";
  if (!productPublished) {
    baseReasons.push("draft_product");
  }

  // 2. Variant active check
  const variantActive = Boolean(variant.isActive);
  if (!variantActive) {
    baseReasons.push("inactive_variant");
  }

  // 3. Variant available check
  const variantAvailable = variant.availabilityStatus === "available";
  if (!variantAvailable) {
    baseReasons.push("unavailable_variant");
  }

  // 4. Resolve all active placements for this variant
  let activePlacements: DesignPlacement[] = [];
  if (placements && placements.length > 0) {
    activePlacements = placements.filter((p) => p.isActive);
  } else if (placement && placement.isActive) {
    activePlacements = [placement];
  }

  let designAssigned = false;
  let placementValid = false;
  let artworkPresent = false;

  if (activePlacements.length === 0) {
    baseReasons.push("missing_design");
  } else {
    designAssigned = true;
    placementValid = true;
    artworkPresent = true;

    for (const pl of activePlacements) {
      // Validate placement dimensions
      const valRes = validateDesignPlacement(pl);
      if (!valRes.isValid) {
        placementValid = false;
        baseReasons.push("invalid_placement_dimensions");
      }

      // Resolve design for this placement (supports multiple designs on same variant)
      const plDesign = designsMap.get(pl.designId) || (design && design.id === pl.designId ? design : design);

      if (!plDesign) {
        designAssigned = false;
        baseReasons.push("missing_design");
      } else if (plDesign.status === "draft") {
        designAssigned = false;
        baseReasons.push("draft_design");
      } else if (plDesign.status === "archived") {
        designAssigned = false;
        baseReasons.push("archived_design");
      }

      const hasArtwork = Boolean(
        plDesign &&
          ((plDesign.storagePath && plDesign.storagePath.trim().length > 0) ||
            (plDesign.assetUrl && plDesign.assetUrl.trim().length > 0)),
      );
      if (!hasArtwork) {
        artworkPresent = false;
        baseReasons.push("missing_artwork");
      }
    }
  }

  // 5. Applicable Approved Primary Mockup check
  const mockupReady = mockups.some(
    (m) =>
      m.status === "approved" &&
      m.isPrimary === true &&
      m.productId === product.id &&
      (!m.variantId || m.variantId === variant.id),
  );
  if (!mockupReady) {
    baseReasons.push("no_approved_primary_mockup");
  }

  // 6. Multi-Provider Path Evaluation (Exact Variant Identity, No Wildcards)
  const providerPathList: Array<{
    provider: PODProvider;
    productVariantId: string;
    providerProduct?: ProviderProduct | null;
    providerVariant?: ProviderVariant | null;
  }> = [];

  if (providerMappings && providerMappings.length > 0) {
    providerMappings.forEach((m) => {
      // Filter out mismatched variant mappings to prevent shadowing
      if (
        (!m.productVariantId || m.productVariantId === variant.id) &&
        (!m.providerVariant || m.providerVariant.productVariantId === variant.id)
      ) {
        providerPathList.push({
          provider: m.provider,
          productVariantId: variant.id,
          providerProduct: m.providerProduct,
          providerVariant: m.providerVariant,
        });
      }
    });
  } else if (providerProduct || providerVariant) {
    const pSlug = providerProduct?.providerId === "a0000000-0000-0000-0000-000000000001" ? "qikink" : "printrove";
    const pName = pSlug === "qikink" ? "Qikink" : "Printrove";
    providerPathList.push({
      provider: {
        id: providerProduct?.providerId || "a0000000-0000-0000-0000-000000000001",
        slug: pSlug,
        name: pName,
        isActive: true,
        createdAt: new Date().toISOString(),
      },
      productVariantId: variant.id,
      providerProduct,
      providerVariant,
    });
  } else if (providers.length > 0) {
    providers.forEach((p) => {
      providerPathList.push({ provider: p, productVariantId: variant.id });
    });
  }

  const providerReadinessList: ProviderReadiness[] = [];
  let atLeastOneProviderReady = false;

  if (providerPathList.length === 0) {
    baseReasons.push("missing_provider");
  } else {
    for (const pPath of providerPathList) {
      const pReasons: ReadinessBlockingReason[] = [...baseReasons];
      const pProd = pPath.providerProduct;
      const pVar = pPath.providerVariant;

      if (!pPath.provider || !pPath.provider.isActive) {
        pReasons.push("disabled_provider_mapping");
      }

      if (!pProd || !pProd.externalProductId) {
        pReasons.push("missing_provider_product_mapping");
      } else if (pProd.mappingStatus === "disabled") {
        pReasons.push("disabled_provider_mapping");
      } else if (pProd.mappingStatus !== "verified") {
        pReasons.push("unverified_provider_product_mapping");
      }

      if (!pVar || !pVar.externalVariantId) {
        pReasons.push("missing_provider_variant_mapping");
      } else if (pVar.mappingStatus === "disabled") {
        pReasons.push("disabled_provider_mapping");
      } else if (pVar.mappingStatus !== "verified") {
        pReasons.push("unverified_provider_variant_mapping");
      }

      // Enforce print method & printable area compatibility across EVERY active placement
      if (activePlacements.length > 0 && pProd) {
        const supportedMethods: PrintMethod[] = pProd.printMethodsJson || [];

        for (const pl of activePlacements) {
          // Check print method support (Req #5)
          if (supportedMethods.length > 0 && !supportedMethods.includes(pl.printMethod as PrintMethod)) {
            pReasons.push("unsupported_provider_print_method");
          }

          // Check printable area specifications
          if (pProd.printableAreasJson && pProd.printableAreasJson.length > 0) {
            const areaSpec = pProd.printableAreasJson.find((spec: PrintableAreaSpec) => {
              const specLoc = spec.location || (spec as unknown as { placementLocation?: string }).placementLocation;
              return specLoc === pl.placementLocation && spec.printMethod === pl.printMethod;
            });

            if (!areaSpec) {
              pReasons.push("unsupported_provider_placement");
            } else if (pl.widthMm > areaSpec.maxWidthMm || pl.heightMm > areaSpec.maxHeightMm) {
              pReasons.push("print_exceeds_provider_area");
            }
          }
        }
      }

      const pathReady = pReasons.length === 0;
      if (pathReady) {
        atLeastOneProviderReady = true;
      }

      providerReadinessList.push({
        providerId: pPath.provider.id,
        providerSlug: pPath.provider.slug,
        providerName: pPath.provider.name,
        ready: pathReady,
        reasons: pReasons,
      });
    }
  }

  const providerSelected = providerPathList.some((p) => p.providerProduct !== undefined);
  const providerProductMapped = providerPathList.some((p) => Boolean(p.providerProduct?.externalProductId));
  const providerVariantMapped = providerPathList.some((p) => Boolean(p.providerVariant?.externalVariantId));

  const allCombinedReasons = Array.from(
    new Set([
      ...baseReasons,
      ...providerReadinessList.flatMap((pr) => pr.reasons),
    ]),
  );

  return {
    variantId: variant.id,
    sku: variant.sku,
    size: variant.size,
    color: variant.color,
    readyForFulfillment: atLeastOneProviderReady && baseReasons.length === 0,
    checks: {
      productPublished,
      variantActive,
      variantAvailable,
      designAssigned,
      placementValid,
      artworkPresent,
      providerSelected,
      providerProductMapped,
      providerVariantMapped,
      mockupReady,
    },
    providerReadiness: providerReadinessList,
    blockingReasons: atLeastOneProviderReady && baseReasons.length === 0 ? [] : allCombinedReasons,
  };
}

export function evaluateProductReadiness(input: {
  product: Product;
  providers?: PODProvider[];
  designsMap?: Map<string, DesignAsset>;
  placementsMap?: Map<string, DesignPlacement>;
  placementsList?: DesignPlacement[];
  providerProductsMap?: Map<string, ProviderProduct>;
  providerVariantsMap?: Map<string, ProviderVariant>;
  providerMappingsList?: Array<{
    provider: PODProvider;
    productVariantId?: string;
    providerProduct?: ProviderProduct | null;
    providerVariant?: ProviderVariant | null;
  }>;
  mockups?: ProductMockup[];
}): ProductReadinessReport {
  const {
    product,
    providers = [],
    designsMap = new Map(),
    placementsMap = new Map(),
    placementsList = [],
    providerProductsMap = new Map(),
    providerVariantsMap = new Map(),
    providerMappingsList,
    mockups = [],
  } = input;

  const variants = product.variants || [];
  const variantReports: VariantReadiness[] = variants.map((v) => {
    // Collect ALL active placements for this exact variant
    let vPlacements = placementsList.filter((p) => p.productVariantId === v.id && p.isActive);
    if (vPlacements.length === 0) {
      const fallbackPl = placementsMap.get(v.id) || placementsMap.get(product.id);
      if (fallbackPl && fallbackPl.isActive) {
        vPlacements = [fallbackPl];
      }
    }

    const singlePlacement = vPlacements.length > 0 ? vPlacements[0] : undefined;
    const design = singlePlacement ? designsMap.get(singlePlacement.designId) : undefined;
    const providerProduct = providerProductsMap.get(product.id);
    const providerVariant = providerVariantsMap.get(v.id);
    const productMockups = mockups.filter((m) => m.productId === product.id);

    // Build EXACT per-variant provider mappings directly (Req #1)
    const vProviderMappings = providers.map((prov) => {
      let pProd: ProviderProduct | undefined = undefined;
      let pVar: ProviderVariant | undefined = undefined;

      if (providerMappingsList) {
        const found = providerMappingsList.find(
          (m) =>
            m.provider.id === prov.id &&
            m.productVariantId === v.id &&
            (!m.providerProduct || m.providerProduct.productId === product.id) &&
            (!m.providerVariant || m.providerVariant.productVariantId === v.id),
        );
        if (found) {
          pProd = found.providerProduct || undefined;
          pVar = found.providerVariant || undefined;
        } else {
          // Fallback to product-level provider product if exact entry was not pre-built
          const prodFound = providerMappingsList.find(
            (m) => m.provider.id === prov.id && m.providerProduct?.productId === product.id,
          );
          pProd = prodFound?.providerProduct || undefined;
        }
      } else {
        pProd = providerProduct?.providerId === prov.id ? providerProduct : undefined;
        pVar = providerVariant && pProd ? providerVariant : undefined;
      }

      return {
        provider: prov,
        productVariantId: v.id,
        providerProduct: pProd,
        providerVariant: pVar,
      };
    });

    return evaluateVariantReadiness({
      product,
      variant: v,
      design,
      placement: singlePlacement,
      placements: vPlacements,
      designsMap,
      providers,
      providerProduct,
      providerVariant,
      providerMappings: vProviderMappings,
      mockups: productMockups,
    });
  });

  const readyCount = variantReports.filter((r) => r.readyForFulfillment).length;
  const overallReady = variants.length > 0 && readyCount === variants.length;

  return {
    productId: product.id,
    slug: product.slug,
    title: product.title,
    productPublished: product.status === "active",
    overallReady,
    readyVariantCount: readyCount,
    totalVariantCount: variants.length,
    variants: variantReports,
  };
}
