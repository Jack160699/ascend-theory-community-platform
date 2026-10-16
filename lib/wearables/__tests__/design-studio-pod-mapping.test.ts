import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  validateArtworkUpload,
  ALLOWED_ARTWORK_MIME_TYPES,
  MAX_ARTWORK_FILE_SIZE_BYTES,
} from "../design-storage";
import {
  evaluateVariantReadiness,
  evaluateProductReadiness,
} from "../readiness-engine";
import {
  getAllDesignsAdmin,
  saveDesignAdmin,
  saveProviderMappingAdmin,
  saveMockupAdmin,
} from "../design-store";
import { saveProductAdmin } from "../store";
import type { Product, ProductVariant } from "../types";
import type {
  DesignAsset,
  DesignPlacement,
  ProductMockup,
  PODProvider,
  ProviderProduct,
  ProviderVariant,
  PlacementLocation,
  PrintMethod,
} from "../design-types";
import { PATCH as mockupPatchHandler } from "@/app/api/admin/wearables/mockups/route";

describe("Phase 5 — Design Studio & POD Mapping Tests", () => {
  // ============================================================
  // SECTION 1: Migration 00006 SQL Structure & RLS Security
  // ============================================================
  const sql00006 = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260809000006_design_studio_and_pod_mapping.sql"),
    "utf-8",
  );

  it("migration 00006 exists and extends designs, design_placements, provider_products, provider_variants, and creates product_mockups", () => {
    assert.strictEqual(sql00006.includes("ALTER TABLE public.designs"), true);
    assert.strictEqual(sql00006.includes("ALTER TABLE public.design_placements"), true);
    assert.strictEqual(sql00006.includes("ALTER TABLE public.provider_products"), true);
    assert.strictEqual(sql00006.includes("ALTER TABLE public.provider_variants"), true);
    assert.strictEqual(sql00006.includes("CREATE TABLE IF NOT EXISTS public.product_mockups"), true);
  });

  it("migration 00006 seeds default Qikink and Printrove provider records", () => {
    assert.strictEqual(sql00006.includes("'Qikink'"), true);
    assert.strictEqual(sql00006.includes("'Printrove'"), true);
  });

  it("migration 00006 contains partial unique index on provider_products(provider_id, product_id)", () => {
    assert.strictEqual(
      sql00006.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_provider_product_per_provider"),
      true,
    );
    assert.strictEqual(sql00006.includes("ON public.provider_products (provider_id, product_id)"), true);
  });

  it("migration 00006 public read approved mockups RLS policy requires active parent product and active available variant", () => {
    assert.strictEqual(sql00006.includes('CREATE POLICY "Public read approved mockups" ON public.product_mockups'), true);
    assert.strictEqual(sql00006.includes("p.status = 'active'"), true);
    assert.strictEqual(sql00006.includes("v.availability_status = 'available'"), true);
  });

  it("migration 00006 grants SELECT only on PUBLIC-SAFE columns of product_mockups to anon/authenticated", () => {
    assert.strictEqual(
      sql00006.includes(
        "GRANT SELECT (id, product_id, variant_id, image_url, view_type, is_primary, sort_order, status, created_at, updated_at)",
      ),
      true,
    );
    assert.strictEqual(sql00006.includes("ON public.product_mockups TO anon, authenticated;"), true);
  });

  it("migration 00006 scopes all admin RLS policies explicitly TO authenticated", () => {
    const adminPolicies = [
      'CREATE POLICY "Admin read designs" ON public.designs',
      'CREATE POLICY "Admin write designs" ON public.designs',
      'CREATE POLICY "Admin read design placements" ON public.design_placements',
      'CREATE POLICY "Admin write design placements" ON public.design_placements',
      'CREATE POLICY "Admin read pod providers" ON public.pod_providers',
      'CREATE POLICY "Admin write pod providers" ON public.pod_providers',
      'CREATE POLICY "Admin read provider products" ON public.provider_products',
      'CREATE POLICY "Admin write provider products" ON public.provider_products',
      'CREATE POLICY "Admin read provider variants" ON public.provider_variants',
      'CREATE POLICY "Admin write provider variants" ON public.provider_variants',
      'CREATE POLICY "Admin read product mockups" ON public.product_mockups',
      'CREATE POLICY "Admin write product mockups" ON public.product_mockups',
    ];

    for (const pol of adminPolicies) {
      assert.strictEqual(sql00006.includes(pol), true, `Policy '${pol}' must exist in migration 00006`);
    }
  });

  it("migration 00006 revokes direct table privileges from PUBLIC/anon/authenticated and grants to service_role ONLY", () => {
    assert.strictEqual(sql00006.includes("REVOKE ALL ON public.designs FROM PUBLIC, anon, authenticated;"), true);
    assert.strictEqual(sql00006.includes("REVOKE ALL ON public.design_placements FROM PUBLIC, anon, authenticated;"), true);
    assert.strictEqual(sql00006.includes("REVOKE ALL ON public.pod_providers FROM PUBLIC, anon, authenticated;"), true);
    assert.strictEqual(sql00006.includes("REVOKE ALL ON public.provider_products FROM PUBLIC, anon, authenticated;"), true);
    assert.strictEqual(sql00006.includes("REVOKE ALL ON public.provider_variants FROM PUBLIC, anon, authenticated;"), true);
    assert.strictEqual(sql00006.includes("REVOKE ALL ON public.product_mockups FROM PUBLIC, anon, authenticated;"), true);

    assert.strictEqual(sql00006.includes("GRANT ALL ON public.designs TO service_role;"), true);
    assert.strictEqual(sql00006.includes("GRANT ALL ON public.provider_products TO service_role;"), true);
    assert.strictEqual(sql00006.includes("GRANT ALL ON public.product_mockups TO service_role;"), true);
  });

  // ============================================================
  // SECTION 2: Artwork Asset Storage & Upload Validation
  // ============================================================
  it("validateArtworkUpload accepts valid artwork formats (PNG, JPG, WEBP, SVG) under 25MB", () => {
    for (const mime of ALLOWED_ARTWORK_MIME_TYPES) {
      const res = validateArtworkUpload({ mimeType: mime, fileSizeBytes: 5 * 1024 * 1024 });
      assert.strictEqual(res.isValid, true, `MIME ${mime} should be valid`);
    }
  });

  it("validateArtworkUpload rejects unsupported MIME formats (GIF, PDF, HTML, PHP)", () => {
    const badMimes = ["image/gif", "application/pdf", "text/html", "application/x-php"];
    for (const mime of badMimes) {
      const res = validateArtworkUpload({ mimeType: mime, fileSizeBytes: 1024 });
      assert.strictEqual(res.isValid, false, `MIME ${mime} must be rejected`);
    }
  });

  it("validateArtworkUpload rejects 0-byte or oversized (>25MB) files", () => {
    const zeroRes = validateArtworkUpload({ mimeType: "image/png", fileSizeBytes: 0 });
    assert.strictEqual(zeroRes.isValid, false, "0-byte file must be rejected");

    const hugeRes = validateArtworkUpload({ mimeType: "image/png", fileSizeBytes: MAX_ARTWORK_FILE_SIZE_BYTES + 1 });
    assert.strictEqual(hugeRes.isValid, false, ">25MB file must be rejected");
  });

  // ============================================================
  // SECTION 3: Signed URL Non-Persistence Tests
  // ============================================================
  it("signed preview URL is NEVER persisted to designs.asset_url", async () => {
    const saveRes = await saveDesignAdmin(
      {
        design: {
          title: "Private Storage Design",
          slug: "priv-dsg-1",
          status: "draft",
          storagePath: "private/artwork/priv-dsg-1/logo.png",
          previewUrl: "https://signed.preview.url/temp-token-12345",
          mimeType: "image/png",
          fileSizeBytes: 2048,
        },
      },
      "admin-id",
    );

    assert.strictEqual(saveRes.ok, true);
    if (saveRes.ok) {
      assert.strictEqual(saveRes.design.storagePath, "private/artwork/priv-dsg-1/logo.png");
      assert.strictEqual(saveRes.design.assetUrl, "", "assetUrl must remain empty when private storagePath is present");
    }

    const allDesigns = await getAllDesignsAdmin();
    const fetched = allDesigns.find((d) => d.slug === "priv-dsg-1");
    assert.ok(fetched);
    assert.strictEqual(fetched?.storagePath, "private/artwork/priv-dsg-1/logo.png");
    assert.strictEqual(fetched?.assetUrl, "");
    assert.ok(fetched?.previewUrl, "Server must generate previewUrl on read");
    assert.notStrictEqual(fetched?.previewUrl, "https://signed.preview.url/temp-token-12345", "Preview URL must not be static old string");
  });

  // ============================================================
  // SECTION 4: Provider Path Shadowing & Order Independence (Req #1 & #2)
  // ============================================================
  it("unmapped variant M does NOT shadow mapped variant L regardless of array ordering", () => {
    const dummyProductML: Product = {
      id: "prod-ml-shadow",
      slug: "ml-shadow-prod",
      title: "ML Shadow Product",
      status: "active",
      basePricePaise: 100000,
      currency: "INR",
      category: "wearables",
      gender: "unisex",
      isFeatured: false,
      galleryJson: [],
      variants: [
        {
          id: "var-m",
          productId: "prod-ml-shadow",
          sku: "ML-M",
          size: "M",
          color: "black",
          stockQuantity: 10,
          pricePaise: 100000,
          compareAtPricePaise: 0,
          providerCostPaise: 0,
          availabilityStatus: "available",
          isActive: true,
          sortOrder: 0,
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "var-l",
          productId: "prod-ml-shadow",
          sku: "ML-L",
          size: "L",
          color: "black",
          stockQuantity: 10,
          pricePaise: 100000,
          compareAtPricePaise: 0,
          providerCostPaise: 0,
          availabilityStatus: "available",
          isActive: true,
          sortOrder: 1,
          createdAt: "",
          updatedAt: "",
        },
      ],
      createdAt: "",
      updatedAt: "",
    };

    const qikinkProvider: PODProvider = { id: "p-qikink", slug: "qikink", name: "Qikink", isActive: true, createdAt: "" };
    const printroveProvider: PODProvider = { id: "p-printrove", slug: "printrove", name: "Printrove", isActive: true, createdAt: "" };

    const qikinkProd: ProviderProduct = {
      id: "pp-qikink-ml",
      providerId: "p-qikink",
      productId: "prod-ml-shadow",
      externalProductId: "QIK-ML",
      name: "Qikink Hoodie",
      printMethodsJson: ["dtf"],
      printableAreasJson: [{ location: "front" as PlacementLocation, maxWidthMm: 300, maxHeightMm: 400, printMethod: "dtf" as PrintMethod }],
      mappingStatus: "verified",
      createdAt: "",
      updatedAt: "",
    };

    const qikinkVarL: ProviderVariant = {
      id: "pv-qikink-l",
      providerProductId: "pp-qikink-ml",
      productVariantId: "var-l",
      externalVariantId: "QIK-VAR-L",
      sku: "QIK-SKU-L",
      mappingStatus: "verified",
      createdAt: "",
      updatedAt: "",
    };

    // Pre-built providerMappingsList: M has NO providerVariant, L has verified providerVariant
    const providerMappingsList = [
      { provider: qikinkProvider, productVariantId: "var-m", providerProduct: qikinkProd, providerVariant: undefined },
      { provider: qikinkProvider, productVariantId: "var-l", providerProduct: qikinkProd, providerVariant: qikinkVarL },
    ];

    const activeDesign: DesignAsset = {
      id: "dsg-active-ml",
      title: "Active Design ML",
      slug: "active-dsg-ml",
      status: "active",
      storagePath: "artwork/ml.png",
      assetUrl: "https://cdn.example.com/ml.png",
      createdAt: "",
      updatedAt: "",
    };

    const placementM: DesignPlacement = {
      id: "pl-m",
      designId: "dsg-active-ml",
      productId: "prod-ml-shadow",
      productVariantId: "var-m",
      position: "front",
      placementLocation: "front",
      xNormalized: 0.5,
      yNormalized: 0.5,
      scale: 1,
      rotationDeg: 0,
      widthMm: 200,
      heightMm: 250,
      printMethod: "dtf",
      isActive: true,
      createdAt: "",
      updatedAt: "",
    };

    const placementL: DesignPlacement = {
      id: "pl-l",
      designId: "dsg-active-ml",
      productId: "prod-ml-shadow",
      productVariantId: "var-l",
      position: "front",
      placementLocation: "front",
      xNormalized: 0.5,
      yNormalized: 0.5,
      scale: 1,
      rotationDeg: 0,
      widthMm: 200,
      heightMm: 250,
      printMethod: "dtf",
      isActive: true,
      createdAt: "",
      updatedAt: "",
    };

    const mockups: ProductMockup[] = [
      { id: "mock-ml", productId: "prod-ml-shadow", imageUrl: "https://cdn.example.com/m.png", viewType: "front", isPrimary: true, sortOrder: 0, status: "approved", createdAt: "", updatedAt: "" },
    ];

    // 1. Evaluate with order M, L
    const reportForward = evaluateProductReadiness({
      product: dummyProductML,
      providers: [qikinkProvider, printroveProvider],
      designsMap: new Map([["dsg-active-ml", activeDesign]]),
      placementsList: [placementM, placementL],
      providerMappingsList,
      mockups,
    });

    const reportMForward = reportForward.variants.find((v) => v.variantId === "var-m");
    const reportLForward = reportForward.variants.find((v) => v.variantId === "var-l");

    assert.strictEqual(reportMForward?.readyForFulfillment, false, "Variant M is NOT ready because provider variant is missing");
    assert.strictEqual(reportLForward?.readyForFulfillment, true, "Variant L MUST BE READY and not shadowed by M's missing mapping");

    // 2. Evaluate with reversed variant order L, M
    const varsML = dummyProductML.variants || [];
    const dummyProductLM = { ...dummyProductML, variants: [varsML[1], varsML[0]] };
    const reportReverse = evaluateProductReadiness({
      product: dummyProductLM,
      providers: [qikinkProvider, printroveProvider],
      designsMap: new Map([["dsg-active-ml", activeDesign]]),
      placementsList: [placementL, placementM],
      providerMappingsList,
      mockups,
    });

    const reportMReverse = reportReverse.variants.find((v) => v.variantId === "var-m");
    const reportLReverse = reportReverse.variants.find((v) => v.variantId === "var-l");

    assert.strictEqual(reportMReverse?.readyForFulfillment, false, "Reversed order: M is NOT ready");
    assert.strictEqual(reportLReverse?.readyForFulfillment, true, "Reversed order: L MUST BE READY");
  });

  // ============================================================
  // SECTION 5: Parent Verification Cannot Promote Variants & Notes Edit Preserves Status (Req #3 & #4)
  // ============================================================
  it("parent provider product verification does NOT automatically promote mapped variant to verified", async () => {
    const dummyProduct: Product = {
      id: "prod-indep-status",
      slug: "indep-status-prod",
      title: "Independent Status Product",
      status: "active",
      basePricePaise: 100000,
      currency: "INR",
      category: "wearables",
      gender: "unisex",
      isFeatured: false,
      galleryJson: [],
      variants: [
        { id: "var-ind-m", productId: "prod-indep-status", sku: "IND-M", size: "M", color: "black", stockQuantity: 10, pricePaise: 100000, compareAtPricePaise: 0, providerCostPaise: 0, availabilityStatus: "available", isActive: true, sortOrder: 0, createdAt: "", updatedAt: "" },
        { id: "var-ind-l", productId: "prod-indep-status", sku: "IND-L", size: "L", color: "black", stockQuantity: 10, pricePaise: 100000, compareAtPricePaise: 0, providerCostPaise: 0, availabilityStatus: "available", isActive: true, sortOrder: 1, createdAt: "", updatedAt: "" },
      ],
      createdAt: "",
      updatedAt: "",
    };
    await saveProductAdmin(dummyProduct, "admin-id");

    // Save mapping with parent = verified, M = verified, L = mapped
    const initRes = await saveProviderMappingAdmin(
      {
        providerProduct: {
          providerId: "a0000000-0000-0000-0000-000000000001",
          productId: "prod-indep-status",
          externalProductId: "QIK-IND-100",
          printMethodsJson: ["dtf"],
          mappingStatus: "verified",
        },
        providerVariants: [
          { productVariantId: "var-ind-m", externalVariantId: "QIK-V-M", externalSku: "QIK-SKU-M", mappingStatus: "verified" },
          { productVariantId: "var-ind-l", externalVariantId: "QIK-V-L", externalSku: "QIK-SKU-L", mappingStatus: "mapped" }, // MAPPED!
        ],
      },
      "admin-id",
    );

    assert.strictEqual(initRes.ok, true);

    // Edit notes on parent product mapping
    const editRes = await saveProviderMappingAdmin(
      {
        providerProduct: {
          id: initRes.ok ? initRes.providerProduct.id : undefined,
          providerId: "a0000000-0000-0000-0000-000000000001",
          productId: "prod-indep-status",
          externalProductId: "QIK-IND-100",
          printMethodsJson: ["dtf"],
          mappingStatus: "verified",
          notes: "Updated parent operational notes",
        },
        providerVariants: [
          { productVariantId: "var-ind-m", externalVariantId: "QIK-V-M", externalSku: "QIK-SKU-M", mappingStatus: "verified" },
          { productVariantId: "var-ind-l", externalVariantId: "QIK-V-L", externalSku: "QIK-SKU-L", mappingStatus: "mapped" }, // MAPPED!
        ],
      },
      "admin-id",
    );

    assert.strictEqual(editRes.ok, true);
    if (editRes.ok) {
      const vars = editRes.providerProduct.variants || [];
      const varM = vars.find((v) => v.productVariantId === "var-ind-m");
      const varL = vars.find((v) => v.productVariantId === "var-ind-l");

      assert.strictEqual(varM?.mappingStatus, "verified");
      assert.strictEqual(varL?.mappingStatus, "mapped", "Variant L MUST REMAIN 'mapped' and NOT be promoted to 'verified'");
    }
  });

  // ============================================================
  // SECTION 6: Supported Print Method Readiness Rule (Req #5)
  // ============================================================
  it("enforces supported print methods: placement technique not in printMethodsJson blocks provider path", () => {
    const dummyProduct: Product = {
      id: "prod-pm-rule",
      slug: "pm-rule-prod",
      title: "PM Rule Prod",
      status: "active",
      basePricePaise: 100000,
      currency: "INR",
      category: "wearables",
      gender: "unisex",
      isFeatured: false,
      galleryJson: [],
      createdAt: "",
      updatedAt: "",
    };

    const dummyVariant: ProductVariant = {
      id: "var-pm-1",
      productId: "prod-pm-rule",
      sku: "PM-1",
      size: "M",
      color: "black",
      stockQuantity: 10,
      pricePaise: 100000,
      compareAtPricePaise: 0,
      providerCostPaise: 0,
      availabilityStatus: "available",
      isActive: true,
      sortOrder: 0,
      createdAt: "",
      updatedAt: "",
    };

    const activeDesign: DesignAsset = {
      id: "dsg-pm",
      title: "Design PM",
      slug: "dsg-pm",
      status: "active",
      storagePath: "art/pm.png",
      assetUrl: "https://cdn.example.com/pm.png",
      createdAt: "",
      updatedAt: "",
    };

    // Placement specifies embroidery technique
    const embroideryPlacement: DesignPlacement = {
      id: "pl-embroidery",
      designId: "dsg-pm",
      productId: "prod-pm-rule",
      productVariantId: "var-pm-1",
      position: "front",
      placementLocation: "front",
      xNormalized: 0.5,
      yNormalized: 0.5,
      scale: 1,
      rotationDeg: 0,
      widthMm: 100,
      heightMm: 100,
      printMethod: "embroidery", // EMBROIDERY!
      isActive: true,
      createdAt: "",
      updatedAt: "",
    };

    const providerOnlyDtf = {
      provider: { id: "p-dtf-only", slug: "qikink", name: "Qikink", isActive: true, createdAt: "" },
      providerProduct: {
        id: "pp-dtf-only",
        providerId: "p-dtf-only",
        productId: "prod-pm-rule",
        externalProductId: "QIK-DTF-ONLY",
        name: "Qikink DTF Only",
        printMethodsJson: ["dtf" as PrintMethod], // ONLY DTF!
        mappingStatus: "verified" as const,
        createdAt: "",
        updatedAt: "",
      },
      providerVariant: { id: "pv-dtf-only", providerProductId: "pp-dtf-only", productVariantId: "var-pm-1", externalVariantId: "QIK-V1", sku: "QIK-V1", mappingStatus: "verified" as const, createdAt: "", updatedAt: "" },
    };

    const mockups: ProductMockup[] = [
      { id: "mock-pm", productId: "prod-pm-rule", imageUrl: "https://cdn.example.com/mock.png", viewType: "front", isPrimary: true, sortOrder: 0, status: "approved", createdAt: "", updatedAt: "" },
    ];

    const report = evaluateVariantReadiness({
      product: dummyProduct,
      variant: dummyVariant,
      placement: embroideryPlacement,
      designsMap: new Map([["dsg-pm", activeDesign]]),
      providerMappings: [providerOnlyDtf],
      mockups,
    });

    assert.strictEqual(report.readyForFulfillment, false, "Provider path MUST be blocked because provider only supports dtf");
    assert.ok(report.blockingReasons.includes("unsupported_provider_print_method"));
  });

  // ============================================================
  // SECTION 7: Server-Side Validation Errors (Req #6, #7, #8, #9)
  // ============================================================
  it("rejects verified provider product with zero supported print methods", async () => {
    const res = await saveProviderMappingAdmin(
      {
        providerProduct: {
          providerId: "a0000000-0000-0000-0000-000000000001",
          productId: "prod-indep-status",
          externalProductId: "QIK-ZERO-PM",
          printMethodsJson: [], // ZERO METHODS!
          mappingStatus: "verified",
        },
      },
      "admin-id",
    );

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, "Verified provider product requires at least one supported print method");
  });

  it("rejects malformed printable area location, method, or dimensions", async () => {
    // Bad location
    const badLocRes = await saveProviderMappingAdmin(
      {
        providerProduct: {
          providerId: "a0000000-0000-0000-0000-000000000001",
          productId: "prod-indep-status",
          externalProductId: "QIK-BAD-LOC",
          printableAreasJson: [{ location: "invalid_location" as PlacementLocation, maxWidthMm: 100, maxHeightMm: 100, printMethod: "dtf" as PrintMethod }],
          mappingStatus: "mapped",
        },
      },
      "admin-id",
    );
    assert.strictEqual(badLocRes.ok, false);
    assert.strictEqual(badLocRes.error, "malformed_printable_area_location");

    // Bad method
    const badMethodRes = await saveProviderMappingAdmin(
      {
        providerProduct: {
          providerId: "a0000000-0000-0000-0000-000000000001",
          productId: "prod-indep-status",
          externalProductId: "QIK-BAD-METHOD",
          printableAreasJson: [{ location: "front" as PlacementLocation, maxWidthMm: 100, maxHeightMm: 100, printMethod: "laser_etching" as PrintMethod }],
          mappingStatus: "mapped",
        },
      },
      "admin-id",
    );
    assert.strictEqual(badMethodRes.ok, false);
    assert.strictEqual(badMethodRes.error, "malformed_printable_area_print_method");

    // Bad dimensions (maxWidth = 0)
    const badDimRes = await saveProviderMappingAdmin(
      {
        providerProduct: {
          providerId: "a0000000-0000-0000-0000-000000000001",
          productId: "prod-indep-status",
          externalProductId: "QIK-BAD-DIM",
          printableAreasJson: [{ location: "front" as PlacementLocation, maxWidthMm: 0, maxHeightMm: 100, printMethod: "dtf" as PrintMethod }],
          mappingStatus: "mapped",
        },
      },
      "admin-id",
    );
    assert.strictEqual(badDimRes.ok, false);
    assert.strictEqual(badDimRes.error, "invalid_printable_area_dimensions");
  });

  it("rejects duplicate provider product mapping for same provider + Ascend product", async () => {
    const dummyDupProduct: Product = {
      id: "prod-dup-check",
      slug: "dup-check-prod",
      title: "Dup Check Product",
      status: "active",
      basePricePaise: 100000,
      currency: "INR",
      category: "wearables",
      gender: "unisex",
      isFeatured: false,
      galleryJson: [],
      variants: [],
      createdAt: "",
      updatedAt: "",
    };
    await saveProductAdmin(dummyDupProduct, "admin-id");

    const firstRes = await saveProviderMappingAdmin(
      {
        providerProduct: {
          id: "pp-dup-1",
          providerId: "a0000000-0000-0000-0000-000000000001",
          productId: "prod-dup-check",
          externalProductId: "QIK-DUP-1",
          mappingStatus: "mapped",
        },
      },
      "admin-id",
    );
    assert.strictEqual(firstRes.ok, true);

    const dupRes = await saveProviderMappingAdmin(
      {
        providerProduct: {
          id: "pp-dup-2", // DIFFERENT ID!
          providerId: "a0000000-0000-0000-0000-000000000001", // SAME PROVIDER!
          productId: "prod-dup-check", // SAME PRODUCT!
          externalProductId: "QIK-DUP-2",
          mappingStatus: "mapped",
        },
      },
      "admin-id",
    );

    assert.strictEqual(dupRes.ok, false);
    assert.strictEqual(dupRes.error, "duplicate provider_product mapping for same provider and Ascend product");
  });

  it("rejects mapping missing providerProduct.productId or providerVariant.productVariantId", async () => {
    const missingProdId = await saveProviderMappingAdmin(
      {
        providerProduct: {
          providerId: "a0000000-0000-0000-0000-000000000001",
          externalProductId: "QIK-NO-PROD",
          mappingStatus: "mapped",
        },
      },
      "admin-id",
    );
    assert.strictEqual(missingProdId.ok, false);
    assert.strictEqual(missingProdId.error, "providerProduct.productId is required and must reference a valid Ascend product");

    const missingVarId = await saveProviderMappingAdmin(
      {
        providerProduct: {
          providerId: "a0000000-0000-0000-0000-000000000001",
          productId: "prod-indep-status",
          externalProductId: "QIK-NO-VAR",
          mappingStatus: "mapped",
        },
        providerVariants: [
          { externalVariantId: "QIK-V1", externalSku: "QIK-SKU" }, // Missing productVariantId!
        ],
      },
      "admin-id",
    );
    assert.strictEqual(missingVarId.ok, false);
    assert.strictEqual(missingVarId.error, "providerVariant.productVariantId is required and must reference a valid Ascend variant");
  });

  // ============================================================
  // SECTION 8: VERIFICATION OF ZERO PROVIDER NETWORK REQUESTS
  // ============================================================
  it("VERIFIED: Phase 5 code contains NO live Qikink / Printrove API calls or network requests", () => {
    const phase5Files = [
      "lib/wearables/design-types.ts",
      "lib/wearables/design-storage.ts",
      "lib/wearables/placement-validator.ts",
      "lib/wearables/readiness-engine.ts",
      "lib/wearables/design-store.ts",
      "app/api/admin/wearables/designs/route.ts",
      "app/api/admin/wearables/pod-mappings/route.ts",
      "app/api/admin/wearables/mockups/route.ts",
      "app/api/admin/wearables/readiness/route.ts",
    ];

    for (const file of phase5Files) {
      const src = readFileSync(resolve(process.cwd(), file), "utf-8");
      assert.strictEqual(src.includes("qikink.com"), false, `File ${file} must NOT make live network requests to qikink.com`);
      assert.strictEqual(src.includes("printrove.com"), false, `File ${file} must NOT make live network requests to printrove.com`);
      assert.strictEqual(src.includes("fetch('https://api.qikink"), false, `File ${file} must NOT invoke Qikink API`);
    }
  });
});
