-- =============================================================================
-- ASCEND THEORY PLATFORM â€” ADDITIVE MIGRATION (PHASE 4 WEARABLES & CATALOGUE)
-- Migration: 20260809000004_wearables_catalogue_management.sql
-- Description: Extends products, product_variants, collections, and order_items tables.
--              Restricts column SELECT on product_variants to hide provider_cost_paise.
--              Enforces strict public RLS for active+available variants of active products.
--              Adds order_items unique constraint (order_id, sku).
--              Creates SECURITY DEFINER atomic RPC save_product_with_variants.
-- =============================================================================

-- 1. Extend products table
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS subtitle TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'wearables',
  ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES public.collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'unisex',
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seo_title TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT,
  ADD COLUMN IF NOT EXISTS primary_image_url TEXT,
  ADD COLUMN IF NOT EXISTS gallery_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS size_chart_json JSONB;

-- Add check constraint to price_paise on products if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_base_price_paise_check'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_base_price_paise_check CHECK (base_price_paise >= 0);
  END IF;
END $$;

-- 2. Extend product_variants table
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS color_display TEXT,
  ADD COLUMN IF NOT EXISTS compare_at_price_paise BIGINT DEFAULT 0 CHECK (compare_at_price_paise >= 0),
  ADD COLUMN IF NOT EXISTS provider_cost_paise BIGINT DEFAULT 0 CHECK (provider_cost_paise >= 0),
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available', 'unavailable', 'sample_only', 'returned_inventory_only')),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS weight_grams INT DEFAULT 0 CHECK (weight_grams >= 0),
  ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_price_paise_check'
  ) THEN
    ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_price_paise_check CHECK (price_paise >= 0);
  END IF;
END $$;

-- 3. Extend collections table
ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS story TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hero_image_url TEXT,
  ADD COLUMN IF NOT EXISTS media_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 4. Extend order_items table with unique constraint (order_id, sku) for idempotent upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_order_id_sku_key'
  ) THEN
    ALTER TABLE public.order_items ADD CONSTRAINT order_items_order_id_sku_key UNIQUE (order_id, sku);
  END IF;
END $$;

-- Indexes for performance & query optimization
CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);
CREATE INDEX IF NOT EXISTS idx_products_collection_id ON public.products(collection_id);
CREATE INDEX IF NOT EXISTS idx_products_slug ON public.products(slug);
CREATE INDEX IF NOT EXISTS idx_product_variants_is_active ON public.product_variants(is_active);
CREATE INDEX IF NOT EXISTS idx_product_variants_availability ON public.product_variants(availability_status);
CREATE INDEX IF NOT EXISTS idx_collections_status ON public.collections(status);

-- 5. COLUMN-LEVEL PRIVILEGE LOCKDOWN: REVOKE PROVIDER COST FROM ANON / AUTHENTICATED
REVOKE ALL ON public.product_variants FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  product_id,
  sku,
  size,
  color,
  color_display,
  stock_quantity,
  price_paise,
  compare_at_price_paise,
  availability_status,
  is_active,
  weight_grams,
  sort_order,
  created_at,
  updated_at
) ON public.product_variants TO anon, authenticated;

GRANT ALL ON public.product_variants TO service_role;

-- Revoke direct table mutation privileges from anon / authenticated on catalogue tables
REVOKE INSERT, UPDATE, DELETE ON public.products FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.product_variants FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collections FROM anon, authenticated;

-- 6. PUBLIC RLS POLICIES

-- Drop old over-permissive policies
DROP POLICY IF EXISTS "Public read active products" ON public.products;
DROP POLICY IF EXISTS "Public read product variants" ON public.product_variants;
DROP POLICY IF EXISTS "Public read collections" ON public.collections;
DROP POLICY IF EXISTS "Admin full products access" ON public.products;
DROP POLICY IF EXISTS "Admin full variants access" ON public.product_variants;
DROP POLICY IF EXISTS "Public read published active products" ON public.products;
DROP POLICY IF EXISTS "Public read active variants of active products" ON public.product_variants;
DROP POLICY IF EXISTS "Public read published collections" ON public.collections;

-- Public Policy: Read active published products ONLY
CREATE POLICY "Public read published active products" ON public.products
  FOR SELECT
  USING (status = 'active');

-- Public Policy: Read active+available variants belonging ONLY to active published products
CREATE POLICY "Public read active variants of active products" ON public.product_variants
  FOR SELECT
  USING (
    is_active = true AND
    availability_status = 'available' AND
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_variants.product_id AND p.status = 'active'
    )
  );

-- Public Policy: Read published collections ONLY
CREATE POLICY "Public read published collections" ON public.collections
  FOR SELECT
  USING (status = 'published');

-- 7. ADMIN RLS POLICIES

-- Admin Policies: Products
CREATE POLICY "Admin read products" ON public.products
  FOR SELECT
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write products" ON public.products
  FOR ALL
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- Admin Policies: Product Variants
CREATE POLICY "Admin read product variants" ON public.product_variants
  FOR SELECT
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write product variants" ON public.product_variants
  FOR ALL
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- Admin Policies: Collections
CREATE POLICY "Admin read collections" ON public.collections
  FOR SELECT
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write collections" ON public.collections
  FOR ALL
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));


-- 8. ATOMIC PRODUCT + VARIANTS PERSISTENCE RPC WITH 2-PASS VALIDATION
--
-- PASS 1: Validate EVERYTHING. Write NOTHING.
-- PASS 2: Mutate atomically. Any DB error triggers RAISE EXCEPTION which rolls back
--         the entire function execution (PL/pgSQL implicit sub-transaction).
CREATE OR REPLACE FUNCTION public.save_product_with_variants(
  p_product JSONB,
  p_variants JSONB,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Product fields
  v_product_id UUID;
  v_slug TEXT;
  v_title TEXT;
  v_status TEXT;
  v_base_price BIGINT;
  v_collection_id UUID;

  -- Validation pass accumulators
  v_variant_elem JSONB;
  v_variant_id UUID;
  v_sku TEXT;
  v_size TEXT;
  v_color TEXT;
  v_price_paise BIGINT;
  v_cost_paise BIGINT;
  v_compare_paise BIGINT;
  v_weight_grams INT;
  v_avail TEXT;
  v_is_active BOOLEAN;
  v_sort_order INT;

  -- Duplicate-SKU tracking within payload
  v_payload_skus TEXT[] := ARRAY[]::TEXT[];

  -- Submitted variant IDs for reconciliation
  v_submitted_variant_ids UUID[] := ARRAY[]::UUID[];

  -- Used by SKU cross-product check
  v_conflicting_product_id UUID;

BEGIN
  -- =====================================================================
  -- PASS 1: VALIDATE EVERYTHING, WRITE NOTHING
  -- All validation errors use RETURN (safe before any writes).
  -- =====================================================================

  -- 1a. Product-level field validation
  v_product_id := COALESCE((p_product->>'id')::UUID, gen_random_uuid());
  v_slug := LOWER(TRIM(p_product->>'slug'));
  v_title := TRIM(p_product->>'title');
  v_status := COALESCE(p_product->>'status', 'draft');
  v_base_price := COALESCE((p_product->>'basePricePaise')::BIGINT, 0);

  IF v_slug IS NULL OR v_slug = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Product slug is required');
  END IF;
  IF v_title IS NULL OR v_title = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Product title is required');
  END IF;
  IF v_status NOT IN ('draft', 'active', 'archived') THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Invalid product status: ''%s''', v_status));
  END IF;
  IF v_base_price < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Product base price cannot be negative');
  END IF;

  -- 1b. Slug uniqueness (read-only check)
  IF EXISTS (SELECT 1 FROM public.products WHERE slug = v_slug AND id != v_product_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Product slug ''%s'' already exists', v_slug));
  END IF;

  -- 1c. Collection ID validity (if provided)
  IF (p_product->>'collectionId') IS NOT NULL AND TRIM(p_product->>'collectionId') != '' THEN
    v_collection_id := (p_product->>'collectionId')::UUID;
    IF NOT EXISTS (SELECT 1 FROM public.collections WHERE id = v_collection_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', format('Collection ID %s does not exist', v_collection_id));
    END IF;
  END IF;

  -- 1d. Variant array validation (read-only; all variants checked before any write)
  IF p_variants IS NOT NULL AND jsonb_array_length(p_variants) > 0 THEN
    FOR v_variant_elem IN SELECT * FROM jsonb_array_elements(p_variants) LOOP

      v_variant_id := COALESCE((v_variant_elem->>'id')::UUID, gen_random_uuid());
      v_sku := UPPER(TRIM(v_variant_elem->>'sku'));
      v_size := TRIM(v_variant_elem->>'size');
      v_color := TRIM(v_variant_elem->>'color');
      v_price_paise := COALESCE((v_variant_elem->>'pricePaise')::BIGINT, 0);
      v_cost_paise := COALESCE((v_variant_elem->>'providerCostPaise')::BIGINT, 0);
      v_compare_paise := COALESCE((v_variant_elem->>'compareAtPricePaise')::BIGINT, 0);
      v_weight_grams := COALESCE((v_variant_elem->>'weightGrams')::INT, 0);
      v_avail := COALESCE(v_variant_elem->>'availabilityStatus', 'available');
      v_is_active := COALESCE((v_variant_elem->>'isActive')::BOOLEAN, true);

      -- Required field checks
      IF v_sku IS NULL OR v_sku = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Variant SKU is required and cannot be empty');
      END IF;
      IF v_size IS NULL OR v_size = '' THEN
        RETURN jsonb_build_object('ok', false, 'error',
          format('Variant SKU ''%s'' has empty size â€” size is required', v_sku));
      END IF;
      IF v_color IS NULL OR v_color = '' THEN
        RETURN jsonb_build_object('ok', false, 'error',
          format('Variant SKU ''%s'' has empty color â€” color is required', v_sku));
      END IF;

      -- Numeric bounds
      IF v_price_paise < 0 THEN
        RETURN jsonb_build_object('ok', false, 'error',
          format('Variant SKU ''%s'' price cannot be negative', v_sku));
      END IF;
      IF v_cost_paise < 0 THEN
        RETURN jsonb_build_object('ok', false, 'error',
          format('Variant SKU ''%s'' provider cost cannot be negative', v_sku));
      END IF;
      IF v_compare_paise < 0 THEN
        RETURN jsonb_build_object('ok', false, 'error',
          format('Variant SKU ''%s'' compare-at price cannot be negative', v_sku));
      END IF;
      IF v_weight_grams < 0 THEN
        RETURN jsonb_build_object('ok', false, 'error',
          format('Variant SKU ''%s'' weight cannot be negative', v_sku));
      END IF;

      -- Availability enum
      IF v_avail NOT IN ('available', 'unavailable', 'sample_only', 'returned_inventory_only') THEN
        RETURN jsonb_build_object('ok', false, 'error',
          format('Variant SKU ''%s'' has invalid availability_status: ''%s''', v_sku, v_avail));
      END IF;

      -- Duplicate SKU within submitted payload
      IF v_sku = ANY(v_payload_skus) THEN
        RETURN jsonb_build_object('ok', false, 'error',
          format('Duplicate variant SKU ''%s'' in submitted payload', v_sku));
      END IF;
      v_payload_skus := array_append(v_payload_skus, v_sku);

      -- CROSS-PRODUCT VARIANT ID PROTECTION (read-only)
      -- If a variant row already exists with this ID and belongs to a different product â†’ reject
      IF EXISTS (
        SELECT 1 FROM public.product_variants
        WHERE id = v_variant_id AND product_id != v_product_id
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error',
          'variant_product_mismatch: submitted variant ID belongs to a different product');
      END IF;

      -- Cross-product SKU uniqueness (read-only)
      SELECT product_id INTO v_conflicting_product_id
      FROM public.product_variants
      WHERE sku = v_sku AND product_id != v_product_id
      LIMIT 1;

      IF v_conflicting_product_id IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'error',
          format('Variant SKU ''%s'' is already assigned to another product', v_sku));
      END IF;

    END LOOP;
  END IF;

  -- =====================================================================
  -- PASS 2: MUTATE â€” all writes happen here.
  -- From this point on, use RAISE EXCEPTION for any error so that PL/pgSQL
  -- rolls back all prior writes in this function execution before returning.
  -- =====================================================================

  -- 2a. Upsert product
  INSERT INTO public.products (
    id, slug, title, subtitle, description, status, base_price_paise, currency,
    materials, category, collection_id, gender, is_featured, published_at,
    seo_title, seo_description, primary_image_url, gallery_json, size_chart_json, updated_at
  )
  VALUES (
    v_product_id,
    v_slug,
    v_title,
    p_product->>'subtitle',
    p_product->>'description',
    v_status,
    v_base_price,
    COALESCE(p_product->>'currency', 'INR'),
    p_product->>'materials',
    COALESCE(p_product->>'category', 'wearables'),
    NULLIF(p_product->>'collectionId', '')::UUID,
    COALESCE(p_product->>'gender', 'unisex'),
    COALESCE((p_product->>'isFeatured')::BOOLEAN, false),
    CASE WHEN v_status = 'active'
         THEN COALESCE((p_product->>'publishedAt')::TIMESTAMPTZ, now())
         ELSE NULL END,
    p_product->>'seoTitle',
    p_product->>'seoDescription',
    p_product->>'primaryImageUrl',
    COALESCE(p_product->'galleryJson', '[]'::jsonb),
    p_product->'sizeChartJson',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    slug = EXCLUDED.slug,
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    base_price_paise = EXCLUDED.base_price_paise,
    currency = EXCLUDED.currency,
    materials = EXCLUDED.materials,
    category = EXCLUDED.category,
    collection_id = EXCLUDED.collection_id,
    gender = EXCLUDED.gender,
    is_featured = EXCLUDED.is_featured,
    published_at = EXCLUDED.published_at,
    seo_title = EXCLUDED.seo_title,
    seo_description = EXCLUDED.seo_description,
    primary_image_url = EXCLUDED.primary_image_url,
    gallery_json = EXCLUDED.gallery_json,
    size_chart_json = EXCLUDED.size_chart_json,
    updated_at = now();

  -- 2b. Upsert variants (validation already passed in PASS 1)
  IF p_variants IS NOT NULL AND jsonb_array_length(p_variants) > 0 THEN
    FOR v_variant_elem IN SELECT * FROM jsonb_array_elements(p_variants) LOOP

      v_variant_id := COALESCE((v_variant_elem->>'id')::UUID, gen_random_uuid());
      v_sku := UPPER(TRIM(v_variant_elem->>'sku'));
      v_size := TRIM(v_variant_elem->>'size');
      v_color := TRIM(v_variant_elem->>'color');
      v_price_paise := COALESCE((v_variant_elem->>'pricePaise')::BIGINT, 0);
      v_cost_paise := COALESCE((v_variant_elem->>'providerCostPaise')::BIGINT, 0);
      v_compare_paise := COALESCE((v_variant_elem->>'compareAtPricePaise')::BIGINT, 0);
      v_weight_grams := COALESCE((v_variant_elem->>'weightGrams')::INT, 0);
      v_avail := COALESCE(v_variant_elem->>'availabilityStatus', 'available');
      v_is_active := COALESCE((v_variant_elem->>'isActive')::BOOLEAN, true);
      v_sort_order := COALESCE((v_variant_elem->>'sortOrder')::INT, 0);

      INSERT INTO public.product_variants (
        id, product_id, sku, size, color, color_display, stock_quantity,
        price_paise, compare_at_price_paise, provider_cost_paise,
        availability_status, is_active, weight_grams, sort_order, updated_at
      )
      VALUES (
        v_variant_id,
        v_product_id,
        v_sku,
        v_size,
        v_color,
        v_variant_elem->>'colorDisplay',
        COALESCE((v_variant_elem->>'stockQuantity')::INT, 0),
        v_price_paise,
        v_compare_paise,
        v_cost_paise,
        v_avail,
        v_is_active,
        v_weight_grams,
        v_sort_order,
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        sku = EXCLUDED.sku,
        size = EXCLUDED.size,
        color = EXCLUDED.color,
        color_display = EXCLUDED.color_display,
        stock_quantity = EXCLUDED.stock_quantity,
        price_paise = EXCLUDED.price_paise,
        compare_at_price_paise = EXCLUDED.compare_at_price_paise,
        provider_cost_paise = EXCLUDED.provider_cost_paise,
        availability_status = EXCLUDED.availability_status,
        is_active = EXCLUDED.is_active,
        weight_grams = EXCLUDED.weight_grams,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
        -- product_id intentionally excluded from UPDATE: ownership cannot change
        WHERE product_variants.product_id = v_product_id;

      v_submitted_variant_ids := array_append(v_submitted_variant_ids, v_variant_id);
    END LOOP;
  END IF;

  -- 2c. Reconcile removed variants: deactivate any variant for this product not in submitted list
  UPDATE public.product_variants
  SET is_active = false, availability_status = 'unavailable', updated_at = now()
  WHERE product_id = v_product_id
    AND id != ALL(v_submitted_variant_ids);

  -- 2d. Audit log â€” failure here raises exception and rolls back product+variant writes above
  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
  VALUES (
    p_admin_id,
    'save_product_with_variants',
    'product',
    v_product_id::TEXT,
    jsonb_build_object('title', v_title, 'slug', v_slug, 'status', v_status,
                       'variant_count', COALESCE(jsonb_array_length(p_variants), 0))
  );

  RETURN jsonb_build_object('ok', true, 'product_id', v_product_id);

EXCEPTION WHEN OTHERS THEN
  -- Any exception inside the function body causes an automatic rollback of ALL
  -- writes performed in this execution before re-raising as structured failure.
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- Strict RPC Privilege Lockdown
REVOKE ALL ON FUNCTION public.save_product_with_variants(JSONB, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_product_with_variants(JSONB, JSONB, UUID) TO service_role;

-- 9. ATOMIC COLLECTION + AUDIT RPC
-- Writes collection row and audit log in one function execution.
-- Any DB failure raises an exception that rolls back both writes.
CREATE OR REPLACE FUNCTION public.save_collection_with_audit(
  p_collection JSONB,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col_id UUID;
  v_name TEXT;
  v_slug TEXT;
  v_status TEXT;
  v_action TEXT;
BEGIN
  -- PASS 1: Validate
  v_name := TRIM(p_collection->>'name');
  v_slug := LOWER(TRIM(p_collection->>'slug'));
  v_status := COALESCE(p_collection->>'status', 'draft');

  IF v_name IS NULL OR v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Collection name is required');
  END IF;
  IF v_slug IS NULL OR v_slug = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Collection slug is required');
  END IF;
  IF v_status NOT IN ('draft', 'published', 'archived') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Invalid collection status: ''%s''', v_status));
  END IF;

  v_col_id := COALESCE((p_collection->>'id')::UUID, gen_random_uuid());

  -- Slug uniqueness
  IF EXISTS (SELECT 1 FROM public.collections WHERE slug = v_slug AND id != v_col_id) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Collection slug ''%s'' already exists', v_slug));
  END IF;

  v_action := CASE WHEN (p_collection->>'id') IS NOT NULL
                   THEN 'collection_updated'
                   ELSE 'collection_created' END;

  -- PASS 2: Mutate (RAISE EXCEPTION on any failure rolls back both writes)
  INSERT INTO public.collections (
    id, name, slug, description, story, status,
    start_date, end_date, hero_image_url, media_json, sort_order, updated_at
  )
  VALUES (
    v_col_id,
    v_name,
    v_slug,
    p_collection->>'description',
    p_collection->>'story',
    v_status,
    NULLIF(p_collection->>'startDate', '')::TIMESTAMPTZ,
    NULLIF(p_collection->>'endDate', '')::TIMESTAMPTZ,
    p_collection->>'heroImageUrl',
    COALESCE(p_collection->'mediaJson', '[]'::jsonb),
    COALESCE((p_collection->>'sortOrder')::INT, 0),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    description = EXCLUDED.description,
    story = EXCLUDED.story,
    status = EXCLUDED.status,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    hero_image_url = EXCLUDED.hero_image_url,
    media_json = EXCLUDED.media_json,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

  -- Audit â€” failure rolls back the collection upsert above
  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
  VALUES (
    p_admin_id,
    v_action,
    'collection',
    v_col_id::TEXT,
    jsonb_build_object('name', v_name, 'slug', v_slug, 'status', v_status)
  );

  RETURN jsonb_build_object('ok', true, 'collection_id', v_col_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- Strict RPC Privilege Lockdown â€” service_role only
REVOKE ALL ON FUNCTION public.save_collection_with_audit(JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_collection_with_audit(JSONB, UUID) TO service_role;
