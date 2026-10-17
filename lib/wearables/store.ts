import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import type {
  Product,
  ProductVariant,
  Collection,
  PublicProduct,
  PublicProductVariant,
  WearablesOverviewStats,
  ProductStatus,
  CollectionStatus,
} from "./types";
import { validateProductPublishReadiness } from "./validation";
import { DROPS } from "@/lib/data/drops";

// Local seed storage ONLY used when Supabase is completely UNCONFIGURED (local testing without env)
const memoryProducts = new Map<string, Product>();
const memoryVariants = new Map<string, ProductVariant>();
const memoryCollections = new Map<string, Collection>();

function seedMemoryStoreIfNeeded() {
  if (hasSupabaseConfig()) return; // Never seed memory if Supabase is configured
  if (memoryProducts.size > 0) return;

  const defaultCollection: Collection = {
    id: "col-ascend-01",
    name: "Ascend Initial Drop",
    slug: "ascend-initial",
    description: "First release of core matte silhouettes.",
    story: "Discipline in every seam.",
    status: "published",
    startDate: new Date().toISOString(),
    sortOrder: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memoryCollections.set(defaultCollection.id, defaultCollection);

  for (const drop of DROPS) {
    const productId = `prod-${drop.slug}`;
    const product: Product = {
      id: productId,
      slug: drop.slug,
      title: drop.name,
      subtitle: drop.tagline,
      description: drop.description,
      status: "active",
      basePricePaise: Math.round(drop.price.amount * 100),
      currency: drop.price.currency,
      materials: drop.details.join(", "),
      category: drop.category,
      collectionId: defaultCollection.id,
      gender: "unisex",
      isFeatured: drop.slug === "ascend-jacket",
      publishedAt: new Date().toISOString(),
      seoTitle: `${drop.name} — Ascend Theory`,
      seoDescription: drop.description,
      primaryImageUrl: drop.image,
      galleryJson: drop.visuals.map((v) => ({ src: v.src, alt: v.alt, caption: v.caption })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryProducts.set(productId, product);

    const sizes = ["S", "M", "L", "XL"];
    sizes.forEach((size, idx) => {
      const sku = `${drop.slug.toUpperCase()}-${size}`;
      const variant: ProductVariant = {
        id: `var-${drop.slug}-${size}`,
        productId,
        sku,
        size,
        color: "black",
        colorDisplay: "Obsidian Black",
        stockQuantity: drop.scarcity.stockRemaining,
        pricePaise: Math.round(drop.price.amount * 100),
        compareAtPricePaise: 0,
        providerCostPaise: Math.round(drop.price.amount * 40),
        availabilityStatus: "available",
        isActive: true,
        weightGrams: 450,
        sortOrder: idx + 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      memoryVariants.set(variant.id, variant);
    });
  }
}

function sanitizePublicVariant(variant: ProductVariant): PublicProductVariant {
  // Exclude providerCostPaise from public outputs
  const { providerCostPaise: _providerCostPaise, ...publicVariant } = variant;
  return publicVariant;
}

/**
 * Public Catalogue Reader: Returns published active products and their active+available variants ONLY.
 * Excludes draft/archived products and hides providerCostPaise.
 * Empty DB when Supabase is configured returns 0 products (NO static fallback).
 */
export async function getPublicProducts(): Promise<PublicProduct[]> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) return [];

    const { data: productsData, error: pError } = await serviceClient
      .from("products")
      .select("*")
      .eq("status", "active");

    if (pError || !productsData || productsData.length === 0) {
      return [];
    }

    const { data: variantsData } = await serviceClient
      .from("product_variants")
      .select("id, product_id, sku, size, color, color_display, stock_quantity, price_paise, compare_at_price_paise, availability_status, is_active, weight_grams, sort_order, created_at, updated_at")
      .eq("is_active", true)
      .eq("availability_status", "available");

    const variantsMap = new Map<string, ProductVariant[]>();
    (variantsData || []).forEach((v) => {
      const list = variantsMap.get(v.product_id) || [];
      list.push({
        id: v.id,
        productId: v.product_id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        colorDisplay: v.color_display ?? undefined,
        stockQuantity: v.stock_quantity,
        pricePaise: Number(v.price_paise),
        compareAtPricePaise: Number(v.compare_at_price_paise || 0),
        providerCostPaise: 0, // Never exposed
        availabilityStatus: v.availability_status || "available",
        isActive: v.is_active,
        weightGrams: v.weight_grams ?? 0,
        sortOrder: v.sort_order ?? 0,
        createdAt: v.created_at,
        updatedAt: v.updated_at || v.created_at,
      });
      variantsMap.set(v.product_id, list);
    });

    return productsData.map((p) => {
      const fullVariants = variantsMap.get(p.id) || [];
      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        subtitle: p.subtitle ?? undefined,
        description: p.description ?? undefined,
        status: p.status as ProductStatus,
        basePricePaise: Number(p.base_price_paise),
        currency: p.currency,
        materials: p.materials ?? undefined,
        category: p.category ?? "wearables",
        collectionId: p.collection_id ?? undefined,
        gender: p.gender ?? "unisex",
        isFeatured: Boolean(p.is_featured),
        publishedAt: p.published_at ?? undefined,
        seoTitle: p.seo_title ?? undefined,
        seoDescription: p.seo_description ?? undefined,
        primaryImageUrl: p.primary_image_url ?? undefined,
        galleryJson: (p.gallery_json as { src: string; alt?: string; caption?: string }[]) || [],
        createdAt: p.created_at,
        updatedAt: p.updated_at || p.created_at,
        variants: fullVariants.map(sanitizePublicVariant),
      };
    });
  }

  // Local testing memory fallback
  seedMemoryStoreIfNeeded();
  const activeProducts = Array.from(memoryProducts.values()).filter((p) => p.status === "active");

  return activeProducts.map((p) => {
    const vars = Array.from(memoryVariants.values()).filter(
      (v) => v.productId === p.id && v.isActive && v.availabilityStatus === "available"
    );
    return {
      ...p,
      variants: vars.map(sanitizePublicVariant),
    };
  });
}

/**
 * Public Catalogue Reader: Returns single published active product by slug.
 * Returns null for draft or archived products.
 */
export async function getPublicProductBySlug(slug: string): Promise<PublicProduct | null> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) return null;

    const { data: p, error } = await serviceClient
      .from("products")
      .select("*")
      .eq("slug", slug)
      .eq("status", "active")
      .maybeSingle();

    if (error || !p) return null;

    const { data: variantsData } = await serviceClient
      .from("product_variants")
      .select("id, product_id, sku, size, color, color_display, stock_quantity, price_paise, compare_at_price_paise, availability_status, is_active, weight_grams, sort_order, created_at, updated_at")
      .eq("product_id", p.id)
      .eq("is_active", true)
      .eq("availability_status", "available");

    const variants: ProductVariant[] = (variantsData || []).map((v) => ({
      id: v.id,
      productId: v.product_id,
      sku: v.sku,
      size: v.size,
      color: v.color,
      colorDisplay: v.color_display ?? undefined,
      stockQuantity: v.stock_quantity,
      pricePaise: Number(v.price_paise),
      compareAtPricePaise: Number(v.compare_at_price_paise || 0),
      providerCostPaise: 0,
      availabilityStatus: v.availability_status || "available",
      isActive: v.is_active,
      weightGrams: v.weight_grams ?? 0,
      sortOrder: v.sort_order ?? 0,
      createdAt: v.created_at,
      updatedAt: v.updated_at || v.created_at,
    }));

    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle ?? undefined,
      description: p.description ?? undefined,
      status: p.status as ProductStatus,
      basePricePaise: Number(p.base_price_paise),
      currency: p.currency,
      materials: p.materials ?? undefined,
      category: p.category ?? "wearables",
      collectionId: p.collection_id ?? undefined,
      gender: p.gender ?? "unisex",
      isFeatured: Boolean(p.is_featured),
      publishedAt: p.published_at ?? undefined,
      seoTitle: p.seo_title ?? undefined,
      seoDescription: p.seo_description ?? undefined,
      primaryImageUrl: p.primary_image_url ?? undefined,
      galleryJson: (p.gallery_json as { src: string; alt?: string; caption?: string }[]) || [],
      createdAt: p.created_at,
      updatedAt: p.updated_at || p.created_at,
      variants: variants.map(sanitizePublicVariant),
    };
  }

  // Memory fallback
  seedMemoryStoreIfNeeded();
  const p = Array.from(memoryProducts.values()).find((prod) => prod.slug === slug && prod.status === "active");
  if (!p) return null;

  const vars = Array.from(memoryVariants.values()).filter(
    (v) => v.productId === p.id && v.isActive && v.availabilityStatus === "available"
  );
  return {
    ...p,
    variants: vars.map(sanitizePublicVariant),
  };
}

/**
 * Resolves authoritative variant for checkout. Requires exact variant identity agreement across all supplied fields.
 */
export async function getAuthoritativeVariantForCheckout(params: {
  slug?: string;
  sku?: string;
  variantId?: string;
  size?: string;
  color?: string;
}): Promise<{ ok: true; product: Product; variant: ProductVariant } | { ok: false; error: string }> {
  // Require at least sku or variantId or slug
  if (!params.sku && !params.variantId && !params.slug) {
    return { ok: false, error: "Variant SKU, variantId, or product slug required for checkout" };
  }

  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      return { ok: false, error: "Supabase service client unconfigured during checkout variant resolution" };
    }

    let query = serviceClient.from("product_variants").select("*, products!inner(*)");

    if (params.sku) {
      query = query.eq("sku", params.sku.toUpperCase());
    } else if (params.variantId) {
      query = query.eq("id", params.variantId);
    } else {
      query = query.eq("products.slug", params.slug);
    }

    const { data: vData, error: vError } = await query.maybeSingle();

    if (vError || !vData) {
      return { ok: false, error: "Unknown or invalid product variant" };
    }

    const p = vData.products;

    // Verify parent product active
    if (p.status !== "active") {
      return { ok: false, error: `Product '${p.title}' is not active (status: ${p.status})` };
    }

    // Verify variant is_active and availability_status = 'available'
    if (!vData.is_active || vData.availability_status !== "available") {
      return { ok: false, error: `Variant SKU '${vData.sku}' is not active or available for purchase` };
    }

    // STRICT IDENTITY AGREEMENT CHECK
    if (params.variantId && vData.id !== params.variantId) {
      return { ok: false, error: "Variant ID mismatch between submitted cart item and DB record" };
    }
    if (params.sku && vData.sku.toUpperCase() !== params.sku.toUpperCase()) {
      return { ok: false, error: "Variant SKU mismatch between submitted cart item and DB record" };
    }
    if (params.slug && p.slug !== params.slug) {
      return { ok: false, error: "Product slug mismatch between submitted cart item and DB record" };
    }
    if (params.size && vData.size.toUpperCase() !== params.size.toUpperCase()) {
      return { ok: false, error: `Size mismatch: requested '${params.size}', variant is '${vData.size}'` };
    }
    if (params.color && vData.color.toLowerCase() !== params.color.toLowerCase()) {
      return { ok: false, error: `Color mismatch: requested '${params.color}', variant is '${vData.color}'` };
    }

    const product: Product = {
      id: p.id,
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle ?? undefined,
      description: p.description ?? undefined,
      status: p.status as ProductStatus,
      basePricePaise: Number(p.base_price_paise),
      currency: p.currency,
      materials: p.materials ?? undefined,
      category: p.category ?? "wearables",
      collectionId: p.collection_id ?? undefined,
      gender: p.gender ?? "unisex",
      isFeatured: Boolean(p.is_featured),
      publishedAt: p.published_at ?? undefined,
      createdAt: p.created_at,
      updatedAt: p.updated_at || p.created_at,
      galleryJson: p.gallery_json || [],
    };

    const variant: ProductVariant = {
      id: vData.id,
      productId: vData.product_id,
      sku: vData.sku,
      size: vData.size,
      color: vData.color,
      colorDisplay: vData.color_display ?? undefined,
      stockQuantity: vData.stock_quantity,
      pricePaise: Number(vData.price_paise),
      compareAtPricePaise: Number(vData.compare_at_price_paise || 0),
      providerCostPaise: Number(vData.provider_cost_paise || 0),
      availabilityStatus: vData.availability_status || "available",
      isActive: vData.is_active,
      weightGrams: vData.weight_grams ?? 0,
      sortOrder: vData.sort_order ?? 0,
      createdAt: vData.created_at,
      updatedAt: vData.updated_at || vData.created_at,
    };

    return { ok: true, product, variant };
  }

  // Memory fallback for local testing ONLY
  seedMemoryStoreIfNeeded();
  let foundVariant: ProductVariant | undefined;

  if (params.sku) {
    foundVariant = Array.from(memoryVariants.values()).find((v) => v.sku.toUpperCase() === params.sku?.toUpperCase());
  } else if (params.variantId) {
    foundVariant = memoryVariants.get(params.variantId);
  } else if (params.slug) {
    const prod = Array.from(memoryProducts.values()).find((p) => p.slug === params.slug);
    if (prod) {
      foundVariant = Array.from(memoryVariants.values()).find((v) => v.productId === prod.id && v.isActive);
    }
  }

  if (!foundVariant) {
    return { ok: false, error: "Unknown or invalid product variant" };
  }

  const parentProduct = memoryProducts.get(foundVariant.productId);
  if (!parentProduct || parentProduct.status !== "active") {
    return { ok: false, error: "Product is draft or archived" };
  }

  if (!foundVariant.isActive || foundVariant.availabilityStatus !== "available") {
    return { ok: false, error: "Variant is inactive or unavailable" };
  }

  // STRICT IDENTITY AGREEMENT CHECK IN MEMORY
  if (params.variantId && foundVariant.id !== params.variantId) {
    return { ok: false, error: "Variant ID mismatch" };
  }
  if (params.sku && foundVariant.sku.toUpperCase() !== params.sku.toUpperCase()) {
    return { ok: false, error: "Variant SKU mismatch" };
  }
  if (params.slug && parentProduct.slug !== params.slug) {
    return { ok: false, error: "Product slug mismatch" };
  }
  if (params.size && foundVariant.size.toUpperCase() !== params.size.toUpperCase()) {
    return { ok: false, error: `Size mismatch: requested '${params.size}', variant is '${foundVariant.size}'` };
  }
  if (params.color && foundVariant.color.toLowerCase() !== params.color.toLowerCase()) {
    return { ok: false, error: `Color mismatch: requested '${params.color}', variant is '${foundVariant.color}'` };
  }

  return { ok: true, product: parentProduct, variant: foundVariant };
}

/**
 * Admin Reader: Fetch all products for HQ management.
 */
export async function getAllProductsAdmin(): Promise<Product[]> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) throw new Error("Supabase service client is not configured");

    const { data: productsData, error: pErr } = await serviceClient.from("products").select("*").order("created_at", { ascending: false });
    const { data: variantsData, error: vErr } = await serviceClient.from("product_variants").select("*").order("sort_order", { ascending: true });

    if (pErr) throw new Error(`Failed to load products from database: ${pErr.message}`);
    if (vErr) throw new Error(`Failed to load product variants from database: ${vErr.message}`);

    const variantsMap = new Map<string, ProductVariant[]>();
    (variantsData || []).forEach((v) => {
      const list = variantsMap.get(v.product_id) || [];
      list.push({
        id: v.id,
        productId: v.product_id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        colorDisplay: v.color_display ?? undefined,
        stockQuantity: v.stock_quantity,
        pricePaise: Number(v.price_paise),
        compareAtPricePaise: Number(v.compare_at_price_paise || 0),
        providerCostPaise: Number(v.provider_cost_paise || 0),
        availabilityStatus: v.availability_status || "available",
        isActive: v.is_active,
        weightGrams: v.weight_grams ?? 0,
        sortOrder: v.sort_order ?? 0,
        createdAt: v.created_at,
        updatedAt: v.updated_at || v.created_at,
      });
      variantsMap.set(v.product_id, list);
    });

    return (productsData || []).map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle ?? undefined,
      description: p.description ?? undefined,
      status: p.status as ProductStatus,
      basePricePaise: Number(p.base_price_paise),
      currency: p.currency,
      materials: p.materials ?? undefined,
      category: p.category ?? "wearables",
      collectionId: p.collection_id ?? undefined,
      gender: p.gender ?? "unisex",
      isFeatured: Boolean(p.is_featured),
      publishedAt: p.published_at ?? undefined,
      seoTitle: p.seo_title ?? undefined,
      seoDescription: p.seo_description ?? undefined,
      primaryImageUrl: p.primary_image_url ?? undefined,
      galleryJson: (p.gallery_json as { src: string; alt?: string; caption?: string }[]) || [],
      createdAt: p.created_at,
      updatedAt: p.updated_at || p.created_at,
      variants: variantsMap.get(p.id) || [],
    }));
  }

  seedMemoryStoreIfNeeded();
  return Array.from(memoryProducts.values()).map((p) => ({
    ...p,
    variants: Array.from(memoryVariants.values()).filter((v) => v.productId === p.id),
  }));
}

export async function getProductAdmin(id: string): Promise<Product | null> {
  const all = await getAllProductsAdmin();
  return all.find((p) => p.id === id || p.slug === id) || null;
}

/**
 * Admin Reader: Overview statistics for Ascend HQ Wearables dashboard.
 */
export async function getWearablesOverviewStats(): Promise<WearablesOverviewStats> {
  const products = await getAllProductsAdmin();

  let publishedProductsCount = 0;
  let draftProductsCount = 0;
  let activeVariantsCount = 0;
  let productsMissingVariantsCount = 0;
  let productsMissingImageryCount = 0;
  let productsMissingProviderMappingCount = 0;

  for (const p of products) {
    if (p.status === "active") publishedProductsCount++;
    if (p.status === "draft") draftProductsCount++;

    const pVariants = p.variants || [];
    activeVariantsCount += pVariants.filter((v) => v.isActive).length;

    if (pVariants.length === 0) productsMissingVariantsCount++;
    if (!p.primaryImageUrl && (!p.galleryJson || p.galleryJson.length === 0)) productsMissingImageryCount++;

    const unmappedVariants = pVariants.filter((v) => v.providerCostPaise === 0);
    if (unmappedVariants.length > 0 || pVariants.length === 0) {
      productsMissingProviderMappingCount++;
    }
  }

  const collections = await getAllCollectionsAdmin();

  return {
    publishedProductsCount,
    draftProductsCount,
    activeVariantsCount,
    collectionsCount: collections.length,
    productsMissingVariantsCount,
    productsMissingImageryCount,
    productsMissingProviderMappingCount,
  };
}

/**
 * Admin Reader: Get all collections.
 */
export async function getAllCollectionsAdmin(): Promise<Collection[]> {
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) throw new Error("Supabase service client is not configured");

    const { data, error } = await serviceClient.from("collections").select("*").order("sort_order", { ascending: true });
    if (error) throw new Error(`Failed to load collections from database: ${error.message}`);

    return (data || []).map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description ?? undefined,
      story: c.story ?? undefined,
      status: (c.status as CollectionStatus) || "draft",
      startDate: c.start_date ?? undefined,
      endDate: c.end_date ?? undefined,
      heroImageUrl: c.hero_image_url ?? undefined,
      mediaJson: c.media_json || [],
      sortOrder: c.sort_order ?? 0,
      createdAt: c.created_at,
      updatedAt: c.updated_at || c.created_at,
    }));
  }

  seedMemoryStoreIfNeeded();
  return Array.from(memoryCollections.values());
}

/**
 * Admin Mutation: Upsert a Product with variants using ATOMIC RPC save_product_with_variants.
 * Validates slug, SKU uniqueness, publish-readiness, non-negative prices & costs, and reconciles removed variants.
 */
export async function saveProductAdmin(
  input: Omit<Partial<Product>, "variants"> & { variants?: Partial<ProductVariant>[] },
  adminId: string
): Promise<{ ok: true; product: Product } | { ok: false; error: string; errors?: string[] }> {
  const title = input.title?.trim();
  const slug = input.slug?.trim().toLowerCase();

  if (!title || !slug) {
    return { ok: false, error: "Title and slug are required" };
  }

  const inputVariants = input.variants || [];

  // Validate non-negative numbers on variants (client-side before RPC)
  for (const v of inputVariants) {
    if (v.pricePaise !== undefined && v.pricePaise < 0) {
      return { ok: false, error: `Variant price for SKU '${v.sku}' cannot be negative` };
    }
    if (v.providerCostPaise !== undefined && v.providerCostPaise < 0) {
      return { ok: false, error: `Variant provider cost for SKU '${v.sku}' cannot be negative` };
    }
    if (v.compareAtPricePaise !== undefined && v.compareAtPricePaise < 0) {
      return { ok: false, error: `Variant compare-at price for SKU '${v.sku}' cannot be negative` };
    }
  }

  // FAIL-CLOSED: When Supabase is configured, ONLY use the DB path.
  // Never fall through to memory storage if Supabase is misconfigured.
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      return { ok: false, error: "Server configuration error: Supabase service client unavailable" };
    }

    const productId = input.id || crypto.randomUUID();

    const productRecord: Product = {
      id: productId,
      slug,
      title,
      subtitle: input.subtitle,
      description: input.description,
      status: input.status || "draft",
      basePricePaise: input.basePricePaise ?? 0,
      currency: input.currency || "INR",
      materials: input.materials,
      category: input.category || "wearables",
      collectionId: input.collectionId,
      gender: input.gender || "unisex",
      isFeatured: Boolean(input.isFeatured),
      publishedAt: input.status === "active" ? input.publishedAt || new Date().toISOString() : null,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      primaryImageUrl: input.primaryImageUrl,
      galleryJson: input.galleryJson || [],
      sizeChartJson: input.sizeChartJson,
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Enforce publish-readiness validator if activating
    if (input.status === "active") {
      const fullVariants: ProductVariant[] = inputVariants.map((v, idx) => ({
        id: v.id || `var-temp-${idx}`,
        productId,
        sku: v.sku || "",
        size: v.size || "S",
        color: v.color || "black",
        colorDisplay: v.colorDisplay,
        stockQuantity: v.stockQuantity ?? 0,
        pricePaise: v.pricePaise ?? 0,
        compareAtPricePaise: v.compareAtPricePaise ?? 0,
        providerCostPaise: v.providerCostPaise ?? 0,
        availabilityStatus: v.availabilityStatus || "available",
        isActive: v.isActive ?? true,
        sortOrder: v.sortOrder ?? idx,
        createdAt: v.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const validation = validateProductPublishReadiness(productRecord, fullVariants);
      if (!validation.isValid) {
        return { ok: false, error: "Product publish readiness check failed", errors: validation.errors };
      }
    }

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("save_product_with_variants", {
      p_product: productRecord,
      p_variants: inputVariants,
      p_admin_id: adminId,
    });

    if (rpcErr) {
      return { ok: false, error: `Database RPC execution error: ${rpcErr.message}` };
    }

    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      const errMessage = (rpcData as { error?: string })?.error || "Atomic save RPC returned error";
      return { ok: false, error: errMessage };
    }

    // Refresh and return full updated product record from DB
    const updatedProducts = await getAllProductsAdmin();
    const updated = updatedProducts.find((p) => p.id === productId);
    return { ok: true, product: updated || productRecord };
  }

  // LOCAL MEMORY FALLBACK — only entered when hasSupabaseConfig() === false
  seedMemoryStoreIfNeeded();

  const productId = input.id || `prod-${slug}`;

  // ── MEMORY PASS 1: Validate EVERYTHING, write NOTHING ──────────────
  // Slug uniqueness
  for (const [pId, p] of memoryProducts.entries()) {
    if (p.slug === slug && pId !== productId) {
      return { ok: false, error: `Product slug '${slug}' already exists` };
    }
  }

  // Variant validation (all checked before any write)
  const skuSet = new Set<string>();
  for (const v of inputVariants) {
    if (!v.sku || v.sku.trim() === "") {
      return { ok: false, error: "Variant SKU is required and cannot be empty" };
    }
    const sizeVal = v.size?.trim();
    if (!sizeVal) {
      return { ok: false, error: `Variant SKU '${v.sku}' has empty size — size is required` };
    }
    const colorVal = v.color?.trim();
    if (!colorVal) {
      return { ok: false, error: `Variant SKU '${v.sku}' has empty color — color is required` };
    }
    const norm = v.sku.trim().toUpperCase();
    if (skuSet.has(norm)) {
      return { ok: false, error: `Duplicate variant SKU '${v.sku}' in payload` };
    }
    skuSet.add(norm);

    for (const [, varItem] of memoryVariants.entries()) {
      if (varItem.sku.toUpperCase() === norm && varItem.id !== v.id && varItem.productId !== productId) {
        return { ok: false, error: `Variant SKU '${v.sku}' is already assigned to another product` };
      }
    }

    // CROSS-PRODUCT VARIANT ID PROTECTION IN MEMORY
    if (v.id) {
      const existingById = memoryVariants.get(v.id);
      if (existingById && existingById.productId !== productId) {
        return { ok: false, error: "variant_product_mismatch: submitted variant ID belongs to a different product" };
      }
    }
  }

  // ── MEMORY PASS 2: All validation passed — write atomically ─────────
  const productRecord: Product = {
    id: productId,
    slug,
    title,
    subtitle: input.subtitle,
    description: input.description,
    status: input.status || "draft",
    basePricePaise: input.basePricePaise ?? 0,
    currency: input.currency || "INR",
    materials: input.materials,
    category: input.category || "wearables",
    collectionId: input.collectionId,
    gender: input.gender || "unisex",
    isFeatured: Boolean(input.isFeatured),
    publishedAt: input.status === "active" ? input.publishedAt || new Date().toISOString() : null,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    primaryImageUrl: input.primaryImageUrl,
    galleryJson: input.galleryJson || [],
    sizeChartJson: input.sizeChartJson,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memoryProducts.set(productId, productRecord);

  const submittedVariantIds = new Set<string>();
  const savedVariants: ProductVariant[] = [];

  inputVariants.forEach((v, idx) => {
    const varId = v.id || `var-${slug}-${v.size}-${v.color}-${idx}`;
    submittedVariantIds.add(varId);

    const variantRecord: ProductVariant = {
      id: varId,
      productId,
      sku: v.sku!.trim().toUpperCase(),
      size: v.size!.trim(),
      color: v.color!.trim(),
      colorDisplay: v.colorDisplay,
      stockQuantity: v.stockQuantity ?? 0,
      pricePaise: v.pricePaise ?? 0,
      compareAtPricePaise: v.compareAtPricePaise ?? 0,
      providerCostPaise: v.providerCostPaise ?? 0,
      availabilityStatus: v.availabilityStatus || "available",
      isActive: v.isActive ?? true,
      weightGrams: v.weightGrams ?? 0,
      sortOrder: v.sortOrder ?? idx,
      createdAt: v.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryVariants.set(varId, variantRecord);
    savedVariants.push(variantRecord);
  });

  // Reconcile removed variants in memory
  for (const [varId, varItem] of memoryVariants.entries()) {
    if (varItem.productId === productId && !submittedVariantIds.has(varId)) {
      memoryVariants.set(varId, {
        ...varItem,
        isActive: false,
        availabilityStatus: "unavailable",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  productRecord.variants = savedVariants;
  return { ok: true, product: productRecord };
}

/**
 * Admin Mutation: Upsert Collection — uses save_collection_with_audit atomic RPC on Supabase.
 * Fail-closed: when Supabase is configured, never falls back to memory.
 */
export async function saveCollectionAdmin(
  input: Partial<Collection>,
  adminId: string
): Promise<{ ok: true; collection: Collection } | { ok: false; error: string }> {
  const name = input.name?.trim();
  const slug = input.slug?.trim().toLowerCase();

  if (!name || !slug) {
    return { ok: false, error: "Collection name and slug are required" };
  }

  // FAIL-CLOSED: When Supabase is configured, ONLY use the DB path.
  if (hasSupabaseConfig()) {
    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) {
      return { ok: false, error: "Server configuration error: Supabase service client unavailable" };
    }

    const colId = input.id || crypto.randomUUID();
    const collection: Collection = {
      id: colId,
      name,
      slug,
      description: input.description,
      story: input.story,
      status: input.status || "draft",
      startDate: input.startDate,
      endDate: input.endDate,
      heroImageUrl: input.heroImageUrl,
      mediaJson: input.mediaJson || [],
      sortOrder: input.sortOrder ?? 0,
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Use atomic RPC: collection upsert + audit in one transaction
    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("save_collection_with_audit", {
      p_collection: {
        id: colId,
        name: collection.name,
        slug: collection.slug,
        description: collection.description ?? null,
        story: collection.story ?? null,
        status: collection.status,
        startDate: collection.startDate ?? null,
        endDate: collection.endDate ?? null,
        heroImageUrl: collection.heroImageUrl ?? null,
        mediaJson: collection.mediaJson,
        sortOrder: collection.sortOrder,
      },
      p_admin_id: adminId,
    });

    if (rpcErr) {
      return { ok: false, error: `Database RPC execution error: ${rpcErr.message}` };
    }

    if (!rpcData || typeof rpcData !== "object" || !(rpcData as { ok?: boolean }).ok) {
      const errMessage = (rpcData as { error?: string })?.error || "Collection save RPC returned error";
      return { ok: false, error: errMessage };
    }

    return { ok: true, collection };
  }

  // LOCAL MEMORY FALLBACK — only when hasSupabaseConfig() === false
  seedMemoryStoreIfNeeded();
  const colId = input.id || `col-${slug}`;
  const collection: Collection = {
    id: colId,
    name,
    slug,
    description: input.description,
    story: input.story,
    status: input.status || "draft",
    startDate: input.startDate,
    endDate: input.endDate,
    heroImageUrl: input.heroImageUrl,
    mediaJson: input.mediaJson || [],
    sortOrder: input.sortOrder ?? 0,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memoryCollections.set(colId, collection);
  return { ok: true, collection };
}
