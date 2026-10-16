/**
 * Phase 5 — Design & POD Mapping Store (Supabase + Memory Fallback)
 * Manages designs, design placements, provider products/variants mappings, and product mockups.
 * Enforces fail-closed configuration security and 2-pass atomic RPC operations on Supabase.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import type {
  DesignAsset,
  DesignPlacement,
  PlacementLocation,
  PrintMethod,
  PODProvider,
  ProviderProduct,
  ProviderVariant,
  MappingStatus,
  PrintableAreaSpec,
  ProductMockup,
  MockupViewType,
  MockupStatus,
  ProductReadinessReport,
} from "./design-types";
import { validateDesignPlacement } from "./placement-validator";
import { validateArtworkUpload } from "./design-storage";
import { getAllProductsAdmin } from "./store";
import { evaluateProductReadiness } from "./readiness-engine";

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY STORES FOR LOCAL TESTING (when hasSupabaseConfig() === false)
// ─────────────────────────────────────────────────────────────────────────────
const memoryDesigns = new Map<string, DesignAsset>();
const memoryPlacements = new Map<string, DesignPlacement>();
const memoryPODProviders = new Map<string, PODProvider>();
const memoryProviderProducts = new Map<string, ProviderProduct>();
const memoryProviderVariants = new Map<string, ProviderVariant>();
const memoryMockups = new Map<string, ProductMockup>();

function seedPhase5MemoryStoreIfNeeded() {
  if (memoryPODProviders.size === 0) {
    memoryPODProviders.set("a0000000-0000-0000-0000-000000000001", {
      id: "a0000000-0000-0000-0000-000000000001",
      name: "Qikink",
      slug: "qikink",
      isActive: true,
      createdAt: new Date().toISOString(),
    });
    memoryPODProviders.set("a0000000-0000-0000-0000-000000000002", {
      id: "a0000000-0000-0000-0000-000000000002",
      name: "Printrove",
      slug: "printrove",
      isActive: true,
      createdAt: new Date().toISOString(),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DESIGNS & PLACEMENTS
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllDesignsAdmin(): Promise<DesignAsset[]> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      throw new Error("Server configuration error: Supabase service client unavailable");
    }

    const { data: dData, error: dErr } = await serviceClient
      .from("designs")
      .select("*")
      .order("created_at", { ascending: false });

    if (dErr) {
      throw new Error(`Failed to fetch designs: ${dErr.message}`);
    }

    const { data: pData, error: pErr } = await serviceClient.from("design_placements").select("*");
    if (pErr) {
      throw new Error(`Failed to fetch design placements: ${pErr.message}`);
    }

    const placementsMap = new Map<string, DesignPlacement[]>();
    (pData || []).forEach((p: Record<string, unknown>) => {
      const pl: DesignPlacement = {
        id: String(p.id),
        designId: String(p.design_id),
        productId: p.product_id ? String(p.product_id) : undefined,
        productVariantId: p.product_variant_id ? String(p.product_variant_id) : undefined,
        position: String(p.position || "front"),
        placementLocation: (p.placement_location || p.position || "front") as PlacementLocation,
        xNormalized: Number(p.x_normalized ?? 0.5),
        yNormalized: Number(p.y_normalized ?? 0.5),
        scale: Number(p.scale ?? 1.0),
        rotationDeg: Number(p.rotation_deg ?? 0),
        widthMm: Number(p.width_mm ?? 200),
        heightMm: Number(p.height_mm ?? 250),
        printMethod: (p.print_method || "dtf") as PrintMethod,
        isActive: Boolean(p.is_active ?? true),
        createdAt: String(p.created_at),
        updatedAt: String(p.updated_at || p.created_at),
      };
      const list = placementsMap.get(String(p.design_id)) || [];
      list.push(pl);
      placementsMap.set(String(p.design_id), list);
    });

    const designList: DesignAsset[] = await Promise.all(
      (dData || []).map(async (d: Record<string, unknown>) => {
        const storagePath = d.storage_path ? String(d.storage_path) : undefined;
        let previewUrl: string | undefined = undefined;

        if (storagePath) {
          const { data: signedData } = await serviceClient.storage
            .from("design-artwork")
            .createSignedUrl(storagePath, 3600);
          previewUrl = signedData?.signedUrl;
        }

        return {
          id: String(d.id),
          title: String(d.title),
          slug: String(d.slug),
          description: d.description ? String(d.description) : undefined,
          status: (d.status || "draft") as DesignAsset["status"],
          assetUrl: String(d.asset_url || ""),
          storagePath,
          previewUrl,
          mimeType: d.mime_type ? String(d.mime_type) : undefined,
          originalFilename: d.original_filename ? String(d.original_filename) : undefined,
          fileSizeBytes: Number(d.file_size_bytes ?? 0),
          checksum: d.checksum ? String(d.checksum) : undefined,
          widthPx: Number(d.width_px ?? 0),
          heightPx: Number(d.height_px ?? 0),
          isTransparent: Boolean(d.is_transparent),
          designer: d.designer ? String(d.designer) : undefined,
          tags: (d.tags as string[]) || [],
          notes: d.notes ? String(d.notes) : undefined,
          version: Number(d.version ?? 1),
          createdAt: String(d.created_at),
          updatedAt: String(d.updated_at || d.created_at),
          placements: placementsMap.get(String(d.id)) || [],
        };
      }),
    );
    return designList;
  }

  seedPhase5MemoryStoreIfNeeded();
  const list = Array.from(memoryDesigns.values());
  return list.map((d) => ({
    ...d,
    previewUrl: d.storagePath ? `https://storage.ascendtheory.local/${d.storagePath}` : undefined,
    placements: Array.from(memoryPlacements.values()).filter((p) => p.designId === d.id && p.isActive),
  }));
}

export async function saveDesignAdmin(
  input: {
    design: Partial<DesignAsset>;
    placements?: Partial<DesignPlacement>[];
  },
  adminId: string,
): Promise<
  | { ok: true; design: DesignAsset }
  | { ok: false; error: string; errors?: string[] }
> {
  const { design, placements = [] } = input;
  const title = design.title?.trim();
  const slug = design.slug?.trim().toLowerCase();
  const status = design.status || "draft";

  if (!title || !slug) {
    return { ok: false, error: "Design title and slug are required" };
  }

  // Validate active design artwork parameters
  if (status === "active") {
    if (!design.storagePath || design.storagePath.trim() === "") {
      return { ok: false, error: "Active design requires valid storage_path" };
    }
    const valRes = validateArtworkUpload({
      mimeType: design.mimeType || "image/png",
      fileSizeBytes: design.fileSizeBytes ?? 1024,
    });
    if (!valRes.isValid) {
      return { ok: false, error: `Active design artwork validation failed: ${valRes.error}` };
    }
  }

  // Validate tags array format if provided
  if (design.tags !== undefined && !Array.isArray(design.tags)) {
    return { ok: false, error: "Design tags must be a JSON array" };
  }

  // Validate all placements
  for (const pl of placements) {
    const valRes = validateDesignPlacement(pl);
    if (!valRes.isValid) {
      return { ok: false, error: valRes.error, errors: valRes.errors };
    }
  }

  // FAIL-CLOSED SUPABASE DB PATH
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      return { ok: false, error: "Server configuration error: Supabase service client unavailable" };
    }

    // Active design storage object existence check
    if (status === "active" && design.storagePath) {
      const { data: fileData, error: fileErr } = await serviceClient.storage
        .from("design-artwork")
        .download(design.storagePath);
      if (fileErr || !fileData) {
        return { ok: false, error: "Active design storage artwork object does not exist in design-artwork bucket" };
      }
    }

    // Ensure signed previewUrl is NEVER written to DB asset_url
    const sanitizedDesign = {
      ...design,
      assetUrl: design.storagePath ? "" : design.assetUrl || "",
    };
    delete (sanitizedDesign as Partial<DesignAsset>).previewUrl;

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("save_design_with_placements", {
      p_design: sanitizedDesign,
      p_placements: placements,
      p_admin_id: adminId,
    });

    if (rpcErr) {
      return { ok: false, error: `Database RPC execution error: ${rpcErr.message}` };
    }

    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      const errMessage = (rpcData as { error?: string })?.error || "Atomic design save RPC returned error";
      return { ok: false, error: errMessage };
    }

    const allDesigns = await getAllDesignsAdmin();
    const updated = allDesigns.find((d) => d.slug === slug || d.id === design.id);
    return { ok: true, design: updated || (design as DesignAsset) };
  }

  // LOCAL MEMORY FALLBACK
  seedPhase5MemoryStoreIfNeeded();
  const designId = design.id || `dsg-${slug}`;

  // Validate slug uniqueness in memory
  for (const [dId, d] of memoryDesigns.entries()) {
    if (d.slug === slug && dId !== designId) {
      return { ok: false, error: `Design slug '${slug}' already exists` };
    }
  }

  // Placement validations in memory
  const allProducts = await getAllProductsAdmin();
  for (const pl of placements) {
    if (!pl.productId || !pl.productVariantId) {
      return { ok: false, error: "Placement product_id and product_variant_id are required" };
    }

    // Ownership check: variant belongs to product
    const prod = allProducts.find((p) => p.id === pl.productId);
    if (!prod || !(prod.variants || []).some((v) => v.id === pl.productVariantId)) {
      return { ok: false, error: "placement_product_variant_mismatch" };
    }

    // Cross-design placement ID protection
    if (pl.id) {
      const existingPl = memoryPlacements.get(pl.id);
      if (existingPl && existingPl.designId !== designId) {
        return { ok: false, error: "placement_design_mismatch" };
      }
    }
  }

  const designRecord: DesignAsset = {
    id: designId,
    title,
    slug,
    description: design.description,
    status,
    assetUrl: design.storagePath ? "" : design.assetUrl || "",
    storagePath: design.storagePath,
    previewUrl: design.storagePath ? `https://storage.ascendtheory.local/${design.storagePath}` : undefined,
    mimeType: design.mimeType,
    originalFilename: design.originalFilename,
    fileSizeBytes: design.fileSizeBytes ?? 0,
    checksum: design.checksum,
    widthPx: design.widthPx ?? 0,
    heightPx: design.heightPx ?? 0,
    isTransparent: Boolean(design.isTransparent),
    designer: design.designer,
    tags: design.tags || [],
    notes: design.notes,
    version: design.version ?? 1,
    createdAt: design.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  memoryDesigns.set(designId, designRecord);

  const submittedPlIds = new Set<string>();
  const savedPlacements: DesignPlacement[] = [];

  placements.forEach((pl, idx) => {
    const plId = pl.id || `pl-${designId}-${idx}`;
    submittedPlIds.add(plId);

    const plRecord: DesignPlacement = {
      id: plId,
      designId,
      productId: pl.productId,
      productVariantId: pl.productVariantId,
      position: pl.placementLocation || pl.position || "front",
      placementLocation: pl.placementLocation || (pl.position as PlacementLocation) || "front",
      xNormalized: pl.xNormalized ?? 0.5,
      yNormalized: pl.yNormalized ?? 0.5,
      scale: pl.scale ?? 1.0,
      rotationDeg: pl.rotationDeg ?? 0,
      widthMm: pl.widthMm ?? 200,
      heightMm: pl.heightMm ?? 250,
      printMethod: pl.printMethod || "dtf",
      isActive: pl.isActive ?? true,
      createdAt: pl.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryPlacements.set(plId, plRecord);
    savedPlacements.push(plRecord);
  });

  // Reconcile removed placements in memory: set active placements for this design not submitted to isActive = false
  for (const [pId, existingPl] of memoryPlacements.entries()) {
    if (existingPl.designId === designId && !submittedPlIds.has(pId)) {
      memoryPlacements.set(pId, { ...existingPl, isActive: false, updatedAt: new Date().toISOString() });
    }
  }

  designRecord.placements = savedPlacements;
  return { ok: true, design: designRecord };
}

export async function archiveDesignAdmin(
  designId: string,
  adminId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      return { ok: false, error: "Server configuration error: Supabase service client unavailable" };
    }
    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("archive_design_with_audit", {
      p_design_id: designId,
      p_admin_id: adminId,
    });
    if (rpcErr) {
      return { ok: false, error: rpcErr.message };
    }
    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      return { ok: false, error: (rpcData as { error?: string })?.error || "Failed to archive design" };
    }
    return { ok: true };
  }

  seedPhase5MemoryStoreIfNeeded();
  const existing = memoryDesigns.get(designId);
  if (existing) {
    memoryDesigns.set(designId, { ...existing, status: "archived", updatedAt: new Date().toISOString() });
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// POD PROVIDER MAPPINGS
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllPODProvidersAdmin(): Promise<PODProvider[]> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) throw new Error("Server configuration error: Supabase service client unavailable");
    const { data, error } = await serviceClient.from("pod_providers").select("*");
    if (error) throw new Error(`Failed to fetch POD providers: ${error.message}`);
    return (data || []).map((p: Record<string, unknown>) => ({
      id: String(p.id),
      name: String(p.name),
      slug: String(p.slug),
      isActive: Boolean(p.is_active),
      createdAt: String(p.created_at),
    }));
  }

  seedPhase5MemoryStoreIfNeeded();
  return Array.from(memoryPODProviders.values());
}

export async function getAllProviderMappingsAdmin(): Promise<{
  providerProducts: ProviderProduct[];
  providerVariants: ProviderVariant[];
}> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) throw new Error("Server configuration error: Supabase service client unavailable");

    const [ppRes, pvRes] = await Promise.all([
      serviceClient.from("provider_products").select("*"),
      serviceClient.from("provider_variants").select("*"),
    ]);

    if (ppRes.error) throw new Error(`Failed to fetch provider products: ${ppRes.error.message}`);
    if (pvRes.error) throw new Error(`Failed to fetch provider variants: ${pvRes.error.message}`);

    const providerVariants: ProviderVariant[] = (pvRes.data || []).map((v: Record<string, unknown>) => ({
      id: String(v.id),
      providerProductId: String(v.provider_product_id),
      productVariantId: v.product_variant_id ? String(v.product_variant_id) : undefined,
      externalVariantId: String(v.external_variant_id),
      externalSku: String(v.external_sku || v.sku),
      sku: String(v.sku || v.external_sku),
      providerColor: v.provider_color ? String(v.provider_color) : undefined,
      providerSize: v.provider_size ? String(v.provider_size) : undefined,
      mappingStatus: (v.mapping_status || "mapped") as MappingStatus,
      notes: v.notes ? String(v.notes) : undefined,
      verifiedAt: v.verified_at ? String(v.verified_at) : undefined,
      verifiedBy: v.verified_by ? String(v.verified_by) : undefined,
      createdAt: String(v.created_at),
      updatedAt: String(v.updated_at || v.created_at),
    }));

    const providerProducts: ProviderProduct[] = (ppRes.data || []).map((p: Record<string, unknown>) => ({
      id: String(p.id),
      providerId: String(p.provider_id),
      productId: p.product_id ? String(p.product_id) : undefined,
      externalProductId: String(p.external_product_id),
      name: String(p.name),
      title: p.title ? String(p.title) : String(p.name),
      printMethodsJson: (p.print_methods_json as PrintMethod[]) || [],
      printableAreasJson: (p.printable_areas_json as PrintableAreaSpec[]) || [],
      mappingStatus: (p.mapping_status || "unmapped") as MappingStatus,
      notes: p.notes ? String(p.notes) : undefined,
      verifiedAt: p.verified_at ? String(p.verified_at) : undefined,
      verifiedBy: p.verified_by ? String(p.verified_by) : undefined,
      createdAt: String(p.created_at),
      updatedAt: String(p.updated_at || p.created_at),
      variants: providerVariants.filter((v) => v.providerProductId === String(p.id)),
    }));

    return { providerProducts, providerVariants };
  }

  seedPhase5MemoryStoreIfNeeded();
  const pProds = Array.from(memoryProviderProducts.values()).map((p) => ({
    ...p,
    variants: Array.from(memoryProviderVariants.values()).filter((v) => v.providerProductId === p.id),
  }));
  return {
    providerProducts: pProds,
    providerVariants: Array.from(memoryProviderVariants.values()),
  };
}

export async function saveProviderMappingAdmin(
  input: {
    providerProduct: Partial<ProviderProduct>;
    providerVariants?: Partial<ProviderVariant>[];
  },
  adminId: string,
): Promise<{ ok: true; providerProduct: ProviderProduct } | { ok: false; error: string }> {
  const { providerProduct, providerVariants = [] } = input;
  const extProdId = providerProduct.externalProductId?.trim();
  const providerId = providerProduct.providerId;

  if (!providerId || !extProdId) {
    return { ok: false, error: "Provider ID and external_product_id are required" };
  }

  // Require Ascend productId binding (Req #9)
  if (!providerProduct.productId || providerProduct.productId.trim() === "") {
    return { ok: false, error: "providerProduct.productId is required and must reference a valid Ascend product" };
  }

  const allProducts = await getAllProductsAdmin();
  const targetProduct = allProducts.find((p) => p.id === providerProduct.productId);
  if (!targetProduct) {
    return { ok: false, error: "providerProduct.productId is required and must reference a valid Ascend product" };
  }

  // Require verified provider product to have print methods (Req #6)
  if (providerProduct.mappingStatus === "verified") {
    if (!providerProduct.printMethodsJson || providerProduct.printMethodsJson.length === 0) {
      return { ok: false, error: "Verified provider product requires at least one supported print method" };
    }
  }

  // Validate printMethodsJson
  const validMethods = new Set(["dtf", "dtg", "screen_print", "embroidery", "sublimation", "other"]);
  if (providerProduct.printMethodsJson && providerProduct.printMethodsJson.length > 0) {
    for (const m of providerProduct.printMethodsJson) {
      if (!validMethods.has(m)) {
        return { ok: false, error: "malformed_printable_area_print_method" };
      }
    }
  }

  // Validate printableAreasJson (Req #7)
  const validLocations = new Set(["front", "back", "left_chest", "right_chest", "left_sleeve", "right_sleeve", "neck", "custom"]);
  if (providerProduct.printableAreasJson && providerProduct.printableAreasJson.length > 0) {
    for (const area of providerProduct.printableAreasJson) {
      const loc = area.location || (area as unknown as { placementLocation?: string }).placementLocation;
      const pm = area.printMethod || "dtf";
      const w = area.maxWidthMm ?? 0;
      const h = area.maxHeightMm ?? 0;

      if (!loc || !validLocations.has(loc)) {
        return { ok: false, error: "malformed_printable_area_location" };
      }
      if (!pm || !validMethods.has(pm)) {
        return { ok: false, error: "malformed_printable_area_print_method" };
      }
      if (w <= 0 || h <= 0) {
        return { ok: false, error: "invalid_printable_area_dimensions" };
      }
    }
  }

  // Validate variants binding (Req #9)
  const validVariantIds = new Set((targetProduct.variants || []).map((v) => v.id));
  for (const pv of providerVariants) {
    if (!pv.productVariantId) {
      return { ok: false, error: "providerVariant.productVariantId is required and must reference a valid Ascend variant" };
    }
    if (!validVariantIds.has(pv.productVariantId)) {
      return { ok: false, error: "mapping_product_mismatch: variant does not belong to the target product" };
    }
  }

  // FAIL-CLOSED SUPABASE DB PATH
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      return { ok: false, error: "Server configuration error: Supabase service client unavailable" };
    }

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("save_provider_mapping_with_audit", {
      p_provider_product: providerProduct,
      p_provider_variants: providerVariants,
      p_admin_id: adminId,
    });

    if (rpcErr) {
      return { ok: false, error: `Database RPC execution error: ${rpcErr.message}` };
    }

    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      const errMessage = (rpcData as { error?: string })?.error || "Atomic provider mapping RPC returned error";
      return { ok: false, error: errMessage };
    }

    const mappings = await getAllProviderMappingsAdmin();
    const updated = mappings.providerProducts.find(
      (p) => p.externalProductId === extProdId && p.providerId === providerId,
    );
    return { ok: true, providerProduct: updated || (providerProduct as ProviderProduct) };
  }

  // LOCAL MEMORY FALLBACK
  seedPhase5MemoryStoreIfNeeded();
  const provProdId = providerProduct.id || `pprod-${providerId}-${extProdId}`;

  // Enforce unique (provider_id, product_id) in memory (Req #8)
  for (const [, pp] of memoryProviderProducts.entries()) {
    if (pp.id !== provProdId && pp.providerId === providerId && pp.productId === providerProduct.productId) {
      return { ok: false, error: "duplicate provider_product mapping for same provider and Ascend product" };
    }
  }

  const provProdRecord: ProviderProduct = {
    id: provProdId,
    providerId,
    productId: providerProduct.productId,
    externalProductId: extProdId,
    name: providerProduct.name || providerProduct.title || extProdId,
    title: providerProduct.title,
    printMethodsJson: providerProduct.printMethodsJson || ["dtf"],
    printableAreasJson: providerProduct.printableAreasJson || [],
    mappingStatus: providerProduct.mappingStatus || "mapped",
    notes: providerProduct.notes,
    verifiedAt: providerProduct.mappingStatus === "verified" ? new Date().toISOString() : undefined,
    verifiedBy: providerProduct.mappingStatus === "verified" ? adminId : undefined,
    createdAt: providerProduct.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  memoryProviderProducts.set(provProdId, provProdRecord);

  const savedVariants: ProviderVariant[] = [];
  for (let idx = 0; idx < providerVariants.length; idx++) {
    const pv = providerVariants[idx];
    const extVarId = pv.externalVariantId?.trim() || `ext-var-${idx}`;
    const pVarId = pv.id || `pvar-${provProdId}-${extVarId}`;
    const vStatus = pv.mappingStatus || providerProduct.mappingStatus || "mapped";

    const existingPV = memoryProviderVariants.get(pVarId);
    if (existingPV) {
      if (existingPV.providerProductId !== provProdId) {
        return { ok: false, error: "provider_variant_rebound" };
      }
      if (existingPV.productVariantId && pv.productVariantId && existingPV.productVariantId !== pv.productVariantId) {
        return { ok: false, error: "provider_variant_rebound" };
      }
    }

    const pVarRecord: ProviderVariant = {
      id: pVarId,
      providerProductId: provProdId,
      productVariantId: pv.productVariantId,
      externalVariantId: extVarId,
      externalSku: pv.externalSku || extVarId,
      sku: pv.sku || pv.externalSku || extVarId,
      providerColor: pv.providerColor,
      providerSize: pv.providerSize,
      mappingStatus: vStatus,
      notes: pv.notes,
      verifiedAt: vStatus === "verified" ? new Date().toISOString() : undefined,
      verifiedBy: vStatus === "verified" ? adminId : undefined,
      createdAt: pv.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryProviderVariants.set(pVarId, pVarRecord);
    savedVariants.push(pVarRecord);
  }

  provProdRecord.variants = savedVariants;
  return { ok: true, providerProduct: provProdRecord };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT MOCKUPS
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllMockupsAdmin(): Promise<ProductMockup[]> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) throw new Error("Server configuration error: Supabase service client unavailable");
    const { data, error } = await serviceClient.from("product_mockups").select("*").order("sort_order", { ascending: true });
    if (error) throw new Error(`Failed to fetch mockups: ${error.message}`);
    return (data || []).map((m: Record<string, unknown>) => ({
      id: String(m.id),
      productId: String(m.product_id),
      variantId: m.variant_id ? String(m.variant_id) : undefined,
      designId: m.design_id ? String(m.design_id) : undefined,
      placementId: m.placement_id ? String(m.placement_id) : undefined,
      imageUrl: String(m.image_url),
      viewType: (m.view_type || "front") as MockupViewType,
      isPrimary: Boolean(m.is_primary),
      sortOrder: Number(m.sort_order ?? 0),
      status: (m.status || "draft") as MockupStatus,
      createdAt: String(m.created_at),
      updatedAt: String(m.updated_at || m.created_at),
    }));
  }

  seedPhase5MemoryStoreIfNeeded();
  return Array.from(memoryMockups.values());
}

export async function saveMockupAdmin(
  input: Partial<ProductMockup>,
  adminId: string,
): Promise<{ ok: true; mockup: ProductMockup } | { ok: false; error: string }> {
  const { productId, imageUrl } = input;
  if (!productId || !imageUrl || imageUrl.trim() === "") {
    return { ok: false, error: "Product ID and image URL are required for mockup" };
  }

  // Memory rebound & compatibility checks (PASS 1)
  if (!hasSupabaseConfig() && input.id) {
    const existing = memoryMockups.get(input.id);
    if (existing) {
      if (existing.productId !== productId) {
        return { ok: false, error: "mockup_rebound" };
      }
      if ((existing.variantId ?? null) !== (input.variantId ?? null)) {
        return { ok: false, error: "mockup_rebound" };
      }
    }
  }

  const allProducts = await getAllProductsAdmin();
  const prod = allProducts.find((p) => p.id === productId);
  if (!prod) {
    return { ok: false, error: "Mockup product_id does not exist" };
  }

  if (input.variantId) {
    const varExists = (prod.variants || []).some((v) => v.id === input.variantId);
    if (!varExists) {
      return { ok: false, error: "mockup_variant_mismatch: variant does not belong to product" };
    }
  }

  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) return { ok: false, error: "Server configuration error: Supabase service client unavailable" };

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("save_mockup_with_audit", {
      p_mockup: input,
      p_admin_id: adminId,
    });

    if (rpcErr) return { ok: false, error: rpcErr.message };
    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      return { ok: false, error: (rpcData as { error?: string })?.error || "Failed to save mockup" };
    }

    const allMockups = await getAllMockupsAdmin();
    const saved = allMockups.find((m) => m.id === (rpcData as { mockup_id?: string }).mockup_id || m.imageUrl === imageUrl);
    return { ok: true, mockup: saved || (input as ProductMockup) };
  }

  seedPhase5MemoryStoreIfNeeded();
  const mockupId = input.id || `mock-${productId}-${memoryMockups.size + 1}`;
  const record: ProductMockup = {
    id: mockupId,
    productId,
    variantId: input.variantId,
    designId: input.designId,
    placementId: input.placementId,
    imageUrl,
    viewType: input.viewType || "front",
    isPrimary: Boolean(input.isPrimary),
    sortOrder: input.sortOrder ?? 0,
    status: input.status || "draft",
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memoryMockups.set(mockupId, record);
  return { ok: true, mockup: record };
}

export async function setMockupStatusAdmin(
  mockupId: string,
  status: "approved" | "rejected" | "draft",
  adminId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) return { ok: false, error: "Server configuration error: Supabase service client unavailable" };

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("set_mockup_status_with_audit", {
      p_mockup_id: mockupId,
      p_status: status,
      p_admin_id: adminId,
    });

    if (rpcErr) return { ok: false, error: rpcErr.message };
    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      return { ok: false, error: (rpcData as { error?: string })?.error || "Failed to update mockup status" };
    }
    return { ok: true };
  }

  seedPhase5MemoryStoreIfNeeded();
  const existing = memoryMockups.get(mockupId);
  if (existing) {
    memoryMockups.set(mockupId, { ...existing, status, updatedAt: new Date().toISOString() });
  }
  return { ok: true };
}

export async function getProductReadinessReportsAdmin(): Promise<ProductReadinessReport[]> {
  const products = await getAllProductsAdmin();
  const designs = await getAllDesignsAdmin();
  const providers = await getAllPODProvidersAdmin();
  const mappings = await getAllProviderMappingsAdmin();
  const mockups = await getAllMockupsAdmin();

  const designsMap = new Map<string, DesignAsset>();
  const placementsMap = new Map<string, DesignPlacement>();
  const placementsList: DesignPlacement[] = [];

  designs.forEach((d) => {
    designsMap.set(d.id, d);
    (d.placements || []).forEach((pl) => {
      placementsList.push(pl);
      if (pl.productVariantId && pl.isActive) {
        placementsMap.set(pl.productVariantId, pl);
      } else if (pl.productId && pl.isActive && !placementsMap.has(pl.productId)) {
        placementsMap.set(pl.productId, pl);
      }
    });
  });

  return products.map((p) => {
    const providerMappingsList: Array<{
      provider: PODProvider;
      productVariantId: string;
      providerProduct?: ProviderProduct | null;
      providerVariant?: ProviderVariant | null;
    }> = [];

    providers.forEach((prov) => {
      const pProd = mappings.providerProducts.find(
        (pp) => pp.productId === p.id && pp.providerId === prov.id,
      );

      (p.variants || []).forEach((v) => {
        const pVar = mappings.providerVariants.find(
          (pv) => pv.productVariantId === v.id && pv.providerProductId === pProd?.id,
        );
        providerMappingsList.push({
          provider: prov,
          productVariantId: v.id,
          providerProduct: pProd,
          providerVariant: pVar,
        });
      });
    });

    return evaluateProductReadiness({
      product: p,
      providers,
      designsMap,
      placementsMap,
      placementsList,
      providerMappingsList,
      mockups,
    });
  });
}
