-- =============================================================================
-- ASCEND THEORY PLATFORM — ADDITIVE MIGRATION (PHASE 5 DESIGN STUDIO & POD MAPPING)
-- Migration: 20260809000006_design_studio_and_pod_mapping.sql
-- Description: Extends designs, design_placements, pod_providers, provider_products,
--              and provider_variants tables. Adds product_mockups table.
--              Implements column-level privilege security for public mockups.
--              Creates SECURITY DEFINER atomic RPCs for design, placement, provider mapping,
--              mockup, and archive mutations with transactional audit logging.
-- =============================================================================

-- 1. Extend designs table
ALTER TABLE public.designs
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT DEFAULT 0 CHECK (file_size_bytes >= 0),
  ADD COLUMN IF NOT EXISTS checksum TEXT,
  ADD COLUMN IF NOT EXISTS width_px INT DEFAULT 0 CHECK (width_px >= 0),
  ADD COLUMN IF NOT EXISTS height_px INT DEFAULT 0 CHECK (height_px >= 0),
  ADD COLUMN IF NOT EXISTS is_transparent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS designer TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS version INT DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Extend design_placements table
ALTER TABLE public.design_placements
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS placement_location TEXT NOT NULL DEFAULT 'front'
    CHECK (placement_location IN ('front', 'back', 'left_chest', 'right_chest', 'left_sleeve', 'right_sleeve', 'neck', 'custom')),
  ADD COLUMN IF NOT EXISTS x_normalized NUMERIC(6,4) NOT NULL DEFAULT 0.5000
    CHECK (x_normalized >= 0 AND x_normalized <= 1),
  ADD COLUMN IF NOT EXISTS y_normalized NUMERIC(6,4) NOT NULL DEFAULT 0.5000
    CHECK (y_normalized >= 0 AND y_normalized <= 1),
  ADD COLUMN IF NOT EXISTS scale NUMERIC(6,4) NOT NULL DEFAULT 1.0000
    CHECK (scale > 0),
  ADD COLUMN IF NOT EXISTS rotation_deg NUMERIC(6,2) NOT NULL DEFAULT 0.00
    CHECK (rotation_deg >= -360 AND rotation_deg <= 360),
  ADD COLUMN IF NOT EXISTS width_mm INT NOT NULL DEFAULT 200 CHECK (width_mm > 0),
  ADD COLUMN IF NOT EXISTS height_mm INT NOT NULL DEFAULT 250 CHECK (height_mm > 0),
  ADD COLUMN IF NOT EXISTS print_method TEXT NOT NULL DEFAULT 'dtf'
    CHECK (print_method IN ('dtf', 'dtg', 'screen_print', 'embroidery', 'sublimation', 'other')),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Unique constraint for design placement per design, product_variant, and placement_location
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'design_placements_design_variant_location_key'
  ) THEN
    ALTER TABLE public.design_placements
      ADD CONSTRAINT design_placements_design_variant_location_key
      UNIQUE (design_id, product_variant_id, placement_location);
  END IF;
END $$;

-- 3. Seed POD Providers (Qikink & Printrove)
INSERT INTO public.pod_providers (id, name, slug, is_active, created_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001'::UUID, 'Qikink', 'qikink', true, now()),
  ('a0000000-0000-0000-0000-000000000002'::UUID, 'Printrove', 'printrove', true, now())
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active;

-- 4. Extend provider_products table
ALTER TABLE public.provider_products
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS print_methods_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS printable_areas_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mapping_status TEXT NOT NULL DEFAULT 'unmapped'
    CHECK (mapping_status IN ('unmapped', 'draft', 'mapped', 'verified', 'disabled')),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Unique constraint on provider_products (provider_id, external_product_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_products_provider_external_id_key'
  ) THEN
    ALTER TABLE public.provider_products ADD CONSTRAINT provider_products_provider_external_id_key UNIQUE (provider_id, external_product_id);
  END IF;
END $$;

-- Partial Unique Index on provider_products (provider_id, product_id) to prevent duplicate provider products for the same Ascend product (Req #8)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_provider_product_per_provider
  ON public.provider_products (provider_id, product_id)
  WHERE (product_id IS NOT NULL);

-- 5. Extend provider_variants table
ALTER TABLE public.provider_variants
  ADD COLUMN IF NOT EXISTS product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_sku TEXT,
  ADD COLUMN IF NOT EXISTS provider_color TEXT,
  ADD COLUMN IF NOT EXISTS provider_size TEXT,
  ADD COLUMN IF NOT EXISTS mapping_status TEXT NOT NULL DEFAULT 'unmapped'
    CHECK (mapping_status IN ('unmapped', 'draft', 'mapped', 'verified', 'disabled')),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Unique constraints on provider_variants
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_variants_provider_prod_ext_var_key'
  ) THEN
    ALTER TABLE public.provider_variants ADD CONSTRAINT provider_variants_provider_prod_ext_var_key UNIQUE (provider_product_id, external_variant_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_variants_ascend_variant_provider_prod_key'
  ) THEN
    ALTER TABLE public.provider_variants ADD CONSTRAINT provider_variants_ascend_variant_provider_prod_key UNIQUE (product_variant_id, provider_product_id);
  END IF;
END $$;

-- 6. Create product_mockups table
CREATE TABLE IF NOT EXISTS public.product_mockups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  design_id UUID REFERENCES public.designs(id) ON DELETE SET NULL,
  placement_id UUID REFERENCES public.design_placements(id) ON DELETE SET NULL,
  image_url TEXT NOT NULL,
  view_type TEXT NOT NULL DEFAULT 'front'
    CHECK (view_type IN ('front', 'back', 'detail', 'lifestyle')),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique index: only ONE approved primary mockup per (product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::UUID), view_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_approved_primary_mockup
  ON public.product_mockups (product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::UUID), view_type)
  WHERE (status = 'approved' AND is_primary = true);

-- Storage bucket configuration for private design artwork
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('design-artwork', 'design-artwork', false, 26214400, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = 26214400,
      allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_designs_status ON public.designs(status);
CREATE INDEX IF NOT EXISTS idx_design_placements_design_id ON public.design_placements(design_id);
CREATE INDEX IF NOT EXISTS idx_design_placements_product_variant_id ON public.design_placements(product_variant_id);
CREATE INDEX IF NOT EXISTS idx_provider_products_product_id ON public.provider_products(product_id);
CREATE INDEX IF NOT EXISTS idx_provider_variants_product_variant_id ON public.provider_variants(product_variant_id);
CREATE INDEX IF NOT EXISTS idx_product_mockups_product_id ON public.product_mockups(product_id);
CREATE INDEX IF NOT EXISTS idx_product_mockups_status ON public.product_mockups(status);

-- 7. PRIVILEGE & RLS SECURITY LOCKDOWN

-- Revoke direct table access on operational POD mapping & design tables from PUBLIC, anon, authenticated
REVOKE ALL ON public.designs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.design_placements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pod_providers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provider_products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provider_variants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.product_mockups FROM PUBLIC, anon, authenticated;

-- Grant full table access to service_role ONLY
GRANT ALL ON public.designs TO service_role;
GRANT ALL ON public.design_placements TO service_role;
GRANT ALL ON public.pod_providers TO service_role;
GRANT ALL ON public.provider_products TO service_role;
GRANT ALL ON public.provider_variants TO service_role;
GRANT ALL ON public.product_mockups TO service_role;

-- Grant SELECT ONLY on PUBLIC-SAFE columns of product_mockups to anon, authenticated
GRANT SELECT (id, product_id, variant_id, image_url, view_type, is_primary, sort_order, status, created_at, updated_at)
  ON public.product_mockups TO anon, authenticated;

-- Enable RLS on all Phase 5 tables
ALTER TABLE public.designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pod_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_mockups ENABLE ROW LEVEL SECURITY;

-- 8. ADMIN RLS POLICIES — Scoped explicitly TO authenticated
CREATE POLICY "Admin read designs" ON public.designs
  FOR SELECT TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write designs" ON public.designs
  FOR ALL TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- Design Placements
CREATE POLICY "Admin read design placements" ON public.design_placements
  FOR SELECT TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write design placements" ON public.design_placements
  FOR ALL TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- POD Providers
CREATE POLICY "Admin read pod providers" ON public.pod_providers
  FOR SELECT TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write pod providers" ON public.pod_providers
  FOR ALL TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- Provider Products
CREATE POLICY "Admin read provider products" ON public.provider_products
  FOR SELECT TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write provider products" ON public.provider_products
  FOR ALL TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- Provider Variants
CREATE POLICY "Admin read provider variants" ON public.provider_variants
  FOR SELECT TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write provider variants" ON public.provider_variants
  FOR ALL TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- Product Mockups (Public Policy requiring Active Product and Active Available Variant)
CREATE POLICY "Public read approved mockups" ON public.product_mockups
  FOR SELECT TO anon, authenticated
  USING (
    status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_mockups.product_id
        AND p.status = 'active'
    )
    AND (
      variant_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.product_variants v
        WHERE v.id = product_mockups.variant_id
          AND v.product_id = product_mockups.product_id
          AND v.is_active = true
          AND v.availability_status = 'available'
      )
    )
  );

CREATE POLICY "Admin read product mockups" ON public.product_mockups
  FOR SELECT TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write product mockups" ON public.product_mockups
  FOR ALL TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- 9. SECURITY DEFINER ATOMIC RPCs FOR PHASE 5 MUTATIONS

-- 9a. Atomic Design + Placements Persistence RPC (with Disable -> Re-Add Reactivation)
CREATE OR REPLACE FUNCTION public.save_design_with_placements(
  p_design JSONB,
  p_placements JSONB,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_design_id UUID;
  v_title TEXT;
  v_slug TEXT;
  v_status TEXT;
  v_asset_url TEXT;
  v_storage_path TEXT;
  v_mime_type TEXT;
  v_file_size BIGINT;
  v_tags TEXT[];
  v_placement_elem JSONB;
  v_placement_id UUID;
  v_product_id UUID;
  v_variant_id UUID;
  v_loc TEXT;
  v_width_mm INT;
  v_height_mm INT;
  v_x_norm NUMERIC(6,4);
  v_y_norm NUMERIC(6,4);
  v_existing_design_id UUID;
  v_existing_pl_id UUID;
  v_submitted_placement_ids UUID[] := '{}';
  v_disabled_record RECORD;
  v_is_new_design BOOLEAN := false;
  v_is_new_placement BOOLEAN := false;
BEGIN
  -- PASS 1: VALIDATE EVERYTHING, WRITE NOTHING
  v_design_id := COALESCE((p_design->>'id')::UUID, gen_random_uuid());
  v_title := TRIM(p_design->>'title');
  v_slug := LOWER(TRIM(p_design->>'slug'));
  v_status := COALESCE(p_design->>'status', 'draft');
  v_asset_url := TRIM(p_design->>'assetUrl');
  v_storage_path := TRIM(p_design->>'storagePath');
  v_mime_type := TRIM(p_design->>'mimeType');
  v_file_size := COALESCE((p_design->>'fileSizeBytes')::BIGINT, 0);

  IF v_title IS NULL OR v_title = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Design title is required');
  END IF;
  IF v_slug IS NULL OR v_slug = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Design slug is required');
  END IF;
  IF v_status NOT IN ('draft', 'active', 'archived') THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Invalid design status: ''%s''', v_status));
  END IF;

  -- Production active design MUST require valid private storage artwork
  IF v_status = 'active' THEN
    IF v_storage_path IS NULL OR v_storage_path = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Active design requires valid storage_path');
    END IF;
    IF v_mime_type NOT IN ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Active design requires valid allowed artwork MIME type');
    END IF;
    IF v_file_size <= 0 OR v_file_size > 26214400 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Active design fileSizeBytes must be positive and <= 25MB');
    END IF;

    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE table_schema = 'storage' AND table_name = 'objects') THEN
      IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'design-artwork' AND name = v_storage_path) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Active design storage artwork object does not exist in design-artwork bucket');
      END IF;
    END IF;
  END IF;

  IF p_design->'tags' IS NOT NULL AND p_design->'tags' != 'null'::jsonb THEN
    IF jsonb_typeof(p_design->'tags') != 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Design tags must be a JSON array');
    END IF;
    v_tags := ARRAY(SELECT jsonb_array_elements_text(p_design->'tags'));
  ELSE
    v_tags := '{}'::TEXT[];
  END IF;

  IF EXISTS (SELECT 1 FROM public.designs WHERE slug = v_slug AND id != v_design_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Design slug ''%s'' already exists', v_slug));
  END IF;

  -- Validate placements
  IF p_placements IS NOT NULL AND jsonb_array_length(p_placements) > 0 THEN
    FOR v_placement_elem IN SELECT * FROM jsonb_array_elements(p_placements) LOOP
      v_placement_id := (v_placement_elem->>'id')::UUID;
      v_product_id := (v_placement_elem->>'productId')::UUID;
      v_variant_id := (v_placement_elem->>'productVariantId')::UUID;
      v_loc := COALESCE(v_placement_elem->>'placementLocation', 'front');
      v_width_mm := COALESCE((v_placement_elem->>'widthMm')::INT, 0);
      v_height_mm := COALESCE((v_placement_elem->>'heightMm')::INT, 0);
      v_x_norm := COALESCE((v_placement_elem->>'xNormalized')::NUMERIC, 0.5);
      v_y_norm := COALESCE((v_placement_elem->>'yNormalized')::NUMERIC, 0.5);

      IF v_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Placement product_id is required and must exist');
      END IF;
      IF v_variant_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_variant_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Placement product_variant_id is required and must exist');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_variant_id AND product_id = v_product_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'placement_product_variant_mismatch');
      END IF;

      IF v_width_mm <= 0 OR v_height_mm <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Placement physical dimensions (width_mm and height_mm) must be positive');
      END IF;
      IF v_x_norm < 0 OR v_x_norm > 1 OR v_y_norm < 0 OR v_y_norm > 1 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Placement normalized coordinates (x_normalized, y_normalized) must be between 0 and 1');
      END IF;

      IF v_placement_id IS NOT NULL THEN
        SELECT design_id INTO v_existing_design_id FROM public.design_placements WHERE id = v_placement_id;
        IF v_existing_design_id IS NOT NULL AND v_existing_design_id != v_design_id THEN
          RETURN jsonb_build_object('ok', false, 'error', 'placement_design_mismatch');
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- PASS 2: MUTATE
  v_is_new_design := NOT EXISTS (SELECT 1 FROM public.designs WHERE id = v_design_id);

  INSERT INTO public.designs (
    id, title, slug, description, status, asset_url, storage_path,
    mime_type, original_filename, file_size_bytes, checksum,
    width_px, height_px, is_transparent, designer, tags, notes, version, updated_at
  )
  VALUES (
    v_design_id,
    v_title,
    v_slug,
    p_design->>'description',
    v_status,
    COALESCE(v_asset_url, ''),
    v_storage_path,
    v_mime_type,
    p_design->>'originalFilename',
    v_file_size,
    p_design->>'checksum',
    COALESCE((p_design->>'widthPx')::INT, 0),
    COALESCE((p_design->>'heightPx')::INT, 0),
    COALESCE((p_design->>'isTransparent')::BOOLEAN, false),
    p_design->>'designer',
    v_tags,
    p_design->>'notes',
    COALESCE((p_design->>'version')::INT, 1),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    slug = EXCLUDED.slug,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    asset_url = EXCLUDED.asset_url,
    storage_path = EXCLUDED.storage_path,
    mime_type = EXCLUDED.mime_type,
    original_filename = EXCLUDED.original_filename,
    file_size_bytes = EXCLUDED.file_size_bytes,
    checksum = EXCLUDED.checksum,
    width_px = EXCLUDED.width_px,
    height_px = EXCLUDED.height_px,
    is_transparent = EXCLUDED.is_transparent,
    designer = EXCLUDED.designer,
    tags = EXCLUDED.tags,
    notes = EXCLUDED.notes,
    version = EXCLUDED.version,
    updated_at = now();

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
  VALUES (
    p_admin_id,
    CASE WHEN v_is_new_design THEN 'design_created' ELSE 'design_updated' END,
    'design',
    v_design_id::TEXT,
    jsonb_build_object('title', v_title, 'slug', v_slug, 'status', v_status)
  );

  -- Upsert placements with Disable -> Re-Add historical row reuse
  IF p_placements IS NOT NULL AND jsonb_array_length(p_placements) > 0 THEN
    FOR v_placement_elem IN SELECT * FROM jsonb_array_elements(p_placements) LOOP
      v_placement_id := (v_placement_elem->>'id')::UUID;
      v_product_id := (v_placement_elem->>'productId')::UUID;
      v_variant_id := (v_placement_elem->>'productVariantId')::UUID;
      v_loc := COALESCE(v_placement_elem->>'placementLocation', 'front');

      -- Reuse existing historical row if no ID was supplied or if matching location exists
      IF v_placement_id IS NULL THEN
        SELECT id INTO v_existing_pl_id FROM public.design_placements
        WHERE design_id = v_design_id
          AND product_variant_id = v_variant_id
          AND placement_location = v_loc
        LIMIT 1;

        v_placement_id := COALESCE(v_existing_pl_id, gen_random_uuid());
      END IF;

      v_submitted_placement_ids := array_append(v_submitted_placement_ids, v_placement_id);
      v_is_new_placement := NOT EXISTS (SELECT 1 FROM public.design_placements WHERE id = v_placement_id);

      INSERT INTO public.design_placements (
        id, design_id, product_id, product_variant_id, position, placement_location,
        x_normalized, y_normalized, scale, rotation_deg, width_mm, height_mm,
        print_method, is_active, updated_at
      )
      VALUES (
        v_placement_id,
        v_design_id,
        v_product_id,
        v_variant_id,
        v_loc,
        v_loc,
        COALESCE((v_placement_elem->>'xNormalized')::NUMERIC, 0.5),
        COALESCE((v_placement_elem->>'yNormalized')::NUMERIC, 0.5),
        COALESCE((v_placement_elem->>'scale')::NUMERIC, 1.0),
        COALESCE((v_placement_elem->>'rotationDeg')::NUMERIC, 0.0),
        COALESCE((v_placement_elem->>'widthMm')::INT, 200),
        COALESCE((v_placement_elem->>'heightMm')::INT, 250),
        COALESCE(v_placement_elem->>'printMethod', 'dtf'),
        COALESCE((v_placement_elem->>'isActive')::BOOLEAN, true),
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        product_id = EXCLUDED.product_id,
        product_variant_id = EXCLUDED.product_variant_id,
        position = EXCLUDED.position,
        placement_location = EXCLUDED.placement_location,
        x_normalized = EXCLUDED.x_normalized,
        y_normalized = EXCLUDED.y_normalized,
        scale = EXCLUDED.scale,
        rotation_deg = EXCLUDED.rotation_deg,
        width_mm = EXCLUDED.width_mm,
        height_mm = EXCLUDED.height_mm,
        print_method = EXCLUDED.print_method,
        is_active = EXCLUDED.is_active,
        updated_at = now();

      INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
      VALUES (
        p_admin_id,
        CASE WHEN v_is_new_placement THEN 'placement_created' ELSE 'placement_updated' END,
        'design_placement',
        v_placement_id::TEXT,
        jsonb_build_object('design_id', v_design_id, 'product_variant_id', v_variant_id, 'placement_location', v_loc)
      );
    END LOOP;
  END IF;

  -- Reconcile removed placements
  FOR v_disabled_record IN
    SELECT id, product_variant_id FROM public.design_placements
    WHERE design_id = v_design_id
      AND is_active = true
      AND id != ALL(v_submitted_placement_ids)
  LOOP
    UPDATE public.design_placements
    SET is_active = false, updated_at = now()
    WHERE id = v_disabled_record.id;

    INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
    VALUES (
      p_admin_id,
      'placement_disabled',
      'design_placement',
      v_disabled_record.id::TEXT,
      jsonb_build_object('design_id', v_design_id, 'product_variant_id', v_disabled_record.product_variant_id)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'design_id', v_design_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.save_design_with_placements(JSONB, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_design_with_placements(JSONB, JSONB, UUID) TO service_role;

-- 9b. Atomic Archive Design RPC
CREATE OR REPLACE FUNCTION public.archive_design_with_audit(
  p_design_id UUID,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.designs WHERE id = p_design_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Design not found');
  END IF;

  UPDATE public.designs
  SET status = 'archived', updated_at = now()
  WHERE id = p_design_id;

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
  VALUES (p_admin_id, 'design_archived', 'design', p_design_id::TEXT, jsonb_build_object('status', 'archived'));

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_design_with_audit(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_design_with_audit(UUID, UUID) TO service_role;

-- 9c. Atomic Provider Product + Variant Mapping RPC (with Strict Validation & Server-Side Rules)
CREATE OR REPLACE FUNCTION public.save_provider_mapping_with_audit(
  p_provider_product JSONB,
  p_provider_variants JSONB,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prov_prod_id UUID;
  v_provider_id UUID;
  v_ext_prod_id TEXT;
  v_product_id UUID;
  v_status TEXT;
  v_print_methods JSONB;
  v_printable_areas JSONB;
  v_method_elem JSONB;
  v_area_elem JSONB;
  v_method_str TEXT;
  v_area_loc TEXT;
  v_area_method TEXT;
  v_area_w INT;
  v_area_h INT;
  v_variant_elem JSONB;
  v_prov_var_id UUID;
  v_ascend_var_id UUID;
  v_ext_var_id TEXT;
  v_var_status TEXT;
  v_existing_prov_id UUID;
  v_existing_prod_id UUID;
  v_existing_prov_prod_id UUID;
  v_existing_ascend_var_id UUID;
  v_is_new_prov_prod BOOLEAN := false;
  v_is_new_prov_var BOOLEAN := false;
BEGIN
  -- PASS 1: Validate EVERYTHING, write NOTHING
  v_prov_prod_id := COALESCE((p_provider_product->>'id')::UUID, gen_random_uuid());
  v_provider_id := (p_provider_product->>'providerId')::UUID;
  v_ext_prod_id := TRIM(p_provider_product->>'externalProductId');
  v_product_id := (p_provider_product->>'productId')::UUID;
  v_status := COALESCE(p_provider_product->>'mappingStatus', 'draft');

  -- Require product_id to reference a valid Ascend product (Req #9)
  IF v_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'providerProduct.productId is required and must reference a valid Ascend product');
  END IF;

  IF v_status NOT IN ('unmapped', 'draft', 'mapped', 'verified', 'disabled') THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Invalid mapping status: ''%s''', v_status));
  END IF;
  IF v_provider_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.pod_providers WHERE id = v_provider_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valid POD provider_id is required');
  END IF;
  IF v_ext_prod_id IS NULL OR v_ext_prod_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Provider external_product_id is required');
  END IF;

  -- Validate printMethodsJson
  v_print_methods := COALESCE(p_provider_product->'printMethodsJson', '[]'::jsonb);
  IF jsonb_typeof(v_print_methods) != 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'printMethodsJson must be a JSON array');
  END IF;

  -- Require verified provider product to have at least 1 supported print method (Req #6)
  IF v_status = 'verified' AND jsonb_array_length(v_print_methods) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Verified provider product requires at least one supported print method');
  END IF;

  IF jsonb_array_length(v_print_methods) > 0 THEN
    FOR v_method_elem IN SELECT * FROM jsonb_array_elements(v_print_methods) LOOP
      v_method_str := TRIM(v_method_elem#>>'{}');
      IF v_method_str NOT IN ('dtf', 'dtg', 'screen_print', 'embroidery', 'sublimation', 'other') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'malformed_printable_area_print_method');
      END IF;
    END LOOP;
  END IF;

  -- Validate printableAreasJson (Req #7)
  v_printable_areas := COALESCE(p_provider_product->'printableAreasJson', '[]'::jsonb);
  IF jsonb_typeof(v_printable_areas) != 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'printableAreasJson must be a JSON array');
  END IF;

  IF jsonb_array_length(v_printable_areas) > 0 THEN
    FOR v_area_elem IN SELECT * FROM jsonb_array_elements(v_printable_areas) LOOP
      v_area_loc := COALESCE(v_area_elem->>'location', v_area_elem->>'placementLocation');
      v_area_method := COALESCE(v_area_elem->>'printMethod', 'dtf');
      v_area_w := COALESCE((v_area_elem->>'maxWidthMm')::INT, 0);
      v_area_h := COALESCE((v_area_elem->>'maxHeightMm')::INT, 0);

      IF v_area_loc NOT IN ('front', 'back', 'left_chest', 'right_chest', 'left_sleeve', 'right_sleeve', 'neck', 'custom') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'malformed_printable_area_location');
      END IF;
      IF v_area_method NOT IN ('dtf', 'dtg', 'screen_print', 'embroidery', 'sublimation', 'other') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'malformed_printable_area_print_method');
      END IF;
      IF v_area_w <= 0 OR v_area_h <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_printable_area_dimensions');
      END IF;
    END LOOP;
  END IF;

  -- Protect Provider Product Ownership with null-safe comparison
  SELECT provider_id, product_id INTO v_existing_prov_id, v_existing_prod_id
  FROM public.provider_products WHERE id = v_prov_prod_id;

  IF v_existing_prov_id IS NOT NULL AND v_existing_prov_id != v_provider_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_product_rebound');
  END IF;
  IF v_existing_prod_id IS NOT NULL AND v_existing_prod_id != v_product_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_product_rebound');
  END IF;

  -- Validate variant mapping list (Req #9)
  IF p_provider_variants IS NOT NULL AND jsonb_array_length(p_provider_variants) > 0 THEN
    FOR v_variant_elem IN SELECT * FROM jsonb_array_elements(p_provider_variants) LOOP
      v_prov_var_id := COALESCE((v_variant_elem->>'id')::UUID, gen_random_uuid());
      v_ascend_var_id := (v_variant_elem->>'productVariantId')::UUID;
      v_ext_var_id := TRIM(v_variant_elem->>'externalVariantId');
      v_var_status := COALESCE(v_variant_elem->>'mappingStatus', 'unmapped');

      IF v_ascend_var_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_ascend_var_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'providerVariant.productVariantId is required and must reference a valid Ascend variant');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_ascend_var_id AND product_id = v_product_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'mapping_product_mismatch: variant does not belong to the target product');
      END IF;

      IF v_var_status NOT IN ('unmapped', 'draft', 'mapped', 'verified', 'disabled') THEN
        RETURN jsonb_build_object('ok', false, 'error', format('Invalid variant mapping status: ''%s''', v_var_status));
      END IF;
      IF v_ext_var_id IS NULL OR v_ext_var_id = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Provider external_variant_id is required for variant mapping');
      END IF;

      -- Protect Provider Variant Ownership with null-safe comparison
      SELECT provider_product_id, product_variant_id INTO v_existing_prov_prod_id, v_existing_ascend_var_id
      FROM public.provider_variants WHERE id = v_prov_var_id;

      IF v_existing_prov_prod_id IS NOT NULL AND v_existing_prov_prod_id != v_prov_prod_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'provider_variant_rebound');
      END IF;
      IF v_existing_ascend_var_id IS NOT NULL AND v_existing_ascend_var_id != v_ascend_var_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'provider_variant_rebound');
      END IF;
    END LOOP;
  END IF;

  -- PASS 2: Mutate
  v_is_new_prov_prod := NOT EXISTS (SELECT 1 FROM public.provider_products WHERE id = v_prov_prod_id);

  INSERT INTO public.provider_products (
    id, provider_id, product_id, external_product_id, name, title,
    print_methods_json, printable_areas_json, mapping_status, notes,
    verified_at, verified_by, updated_at
  )
  VALUES (
    v_prov_prod_id,
    v_provider_id,
    v_product_id,
    v_ext_prod_id,
    COALESCE(p_provider_product->>'title', p_provider_product->>'name', v_ext_prod_id),
    p_provider_product->>'title',
    v_print_methods,
    v_printable_areas,
    v_status,
    p_provider_product->>'notes',
    CASE WHEN v_status = 'verified' THEN now() ELSE NULL END,
    CASE WHEN v_status = 'verified' THEN p_admin_id ELSE NULL END,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    provider_id = EXCLUDED.provider_id,
    product_id = EXCLUDED.product_id,
    external_product_id = EXCLUDED.external_product_id,
    name = EXCLUDED.name,
    title = EXCLUDED.title,
    print_methods_json = EXCLUDED.print_methods_json,
    printable_areas_json = EXCLUDED.printable_areas_json,
    mapping_status = EXCLUDED.mapping_status,
    notes = EXCLUDED.notes,
    verified_at = EXCLUDED.verified_at,
    verified_by = EXCLUDED.verified_by,
    updated_at = now();

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
  VALUES (
    p_admin_id,
    CASE
      WHEN v_status = 'verified' THEN 'provider_mapping_verified'
      WHEN v_status = 'disabled' THEN 'provider_mapping_disabled'
      WHEN v_is_new_prov_prod THEN 'provider_product_mapped'
      ELSE 'save_provider_mapping_with_audit'
    END,
    'provider_product',
    v_prov_prod_id::TEXT,
    jsonb_build_object('external_product_id', v_ext_prod_id, 'mapping_status', v_status)
  );

  -- Upsert provider variants with variant-specific verification metadata (Req #3 & #4)
  IF p_provider_variants IS NOT NULL AND jsonb_array_length(p_provider_variants) > 0 THEN
    FOR v_variant_elem IN SELECT * FROM jsonb_array_elements(p_provider_variants) LOOP
      v_prov_var_id := COALESCE((v_variant_elem->>'id')::UUID, gen_random_uuid());
      v_ascend_var_id := (v_variant_elem->>'productVariantId')::UUID;
      v_ext_var_id := TRIM(v_variant_elem->>'externalVariantId');
      v_var_status := COALESCE(v_variant_elem->>'mappingStatus', 'unmapped');
      v_is_new_prov_var := NOT EXISTS (SELECT 1 FROM public.provider_variants WHERE id = v_prov_var_id);

      INSERT INTO public.provider_variants (
        id, provider_product_id, product_variant_id, external_variant_id, external_sku,
        sku, provider_color, provider_size, mapping_status, notes, verified_at, verified_by, updated_at
      )
      VALUES (
        v_prov_var_id,
        v_prov_prod_id,
        v_ascend_var_id,
        v_ext_var_id,
        v_variant_elem->>'externalSku',
        COALESCE(v_variant_elem->>'externalSku', v_ext_var_id),
        v_variant_elem->>'providerColor',
        v_variant_elem->>'providerSize',
        v_var_status,
        v_variant_elem->>'notes',
        CASE WHEN v_var_status = 'verified' THEN now() ELSE NULL END,
        CASE WHEN v_var_status = 'verified' THEN p_admin_id ELSE NULL END,
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        provider_product_id = EXCLUDED.provider_product_id,
        product_variant_id = EXCLUDED.product_variant_id,
        external_variant_id = EXCLUDED.external_variant_id,
        external_sku = EXCLUDED.external_sku,
        sku = EXCLUDED.sku,
        provider_color = EXCLUDED.provider_color,
        provider_size = EXCLUDED.provider_size,
        mapping_status = EXCLUDED.mapping_status,
        notes = EXCLUDED.notes,
        verified_at = EXCLUDED.verified_at,
        verified_by = EXCLUDED.verified_by,
        updated_at = now();

      INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
      VALUES (
        p_admin_id,
        CASE WHEN v_is_new_prov_var THEN 'provider_variant_mapped' ELSE 'provider_variant_updated' END,
        'provider_variant',
        v_prov_var_id::TEXT,
        jsonb_build_object('external_variant_id', v_ext_var_id, 'product_variant_id', v_ascend_var_id, 'mapping_status', v_var_status)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'provider_product_id', v_prov_prod_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.save_provider_mapping_with_audit(JSONB, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_provider_mapping_with_audit(JSONB, JSONB, UUID) TO service_role;

-- 9d. Atomic Mockup Save RPC with Null-Safe Rebound & Strict Placement Compatibility
CREATE OR REPLACE FUNCTION public.save_mockup_with_audit(
  p_mockup JSONB,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mockup_id UUID;
  v_product_id UUID;
  v_variant_id UUID;
  v_design_id UUID;
  v_placement_id UUID;
  v_image_url TEXT;
  v_view_type TEXT;
  v_status TEXT;
  v_is_new BOOLEAN := false;
  v_existing_prod_id UUID;
  v_existing_var_id UUID;
  v_pl_design_id UUID;
  v_pl_prod_id UUID;
  v_pl_var_id UUID;
BEGIN
  v_mockup_id := COALESCE((p_mockup->>'id')::UUID, gen_random_uuid());
  v_product_id := (p_mockup->>'productId')::UUID;
  v_variant_id := (p_mockup->>'variantId')::UUID;
  v_design_id := (p_mockup->>'designId')::UUID;
  v_placement_id := (p_mockup->>'placementId')::UUID;
  v_image_url := TRIM(p_mockup->>'imageUrl');
  v_view_type := COALESCE(p_mockup->>'viewType', 'front');
  v_status := COALESCE(p_mockup->>'status', 'draft');

  IF v_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valid product_id is required for mockup');
  END IF;
  IF v_image_url IS NULL OR v_image_url = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Image URL is required for mockup');
  END IF;
  IF v_view_type NOT IN ('front', 'back', 'detail', 'lifestyle') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid mockup view_type');
  END IF;
  IF v_status NOT IN ('draft', 'approved', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid mockup status');
  END IF;

  -- Rebound Protection with NULL-SAFE IS DISTINCT FROM comparison
  IF EXISTS (SELECT 1 FROM public.product_mockups WHERE id = v_mockup_id) THEN
    SELECT product_id, variant_id INTO v_existing_prod_id, v_existing_var_id
    FROM public.product_mockups WHERE id = v_mockup_id;

    IF v_existing_prod_id IS DISTINCT FROM v_product_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'mockup_rebound');
    END IF;
    IF v_existing_var_id IS DISTINCT FROM v_variant_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'mockup_rebound');
    END IF;
  END IF;

  IF v_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_variants WHERE id = v_variant_id AND product_id = v_product_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mockup_variant_mismatch: variant does not belong to product');
  END IF;

  IF v_design_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.designs WHERE id = v_design_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mockup design_id does not exist');
  END IF;

  -- Placement compatibility check
  IF v_placement_id IS NOT NULL THEN
    SELECT design_id, product_id, product_variant_id INTO v_pl_design_id, v_pl_prod_id, v_pl_var_id
    FROM public.design_placements WHERE id = v_placement_id;

    IF v_pl_design_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Mockup placement_id does not exist');
    END IF;
    IF v_pl_prod_id != v_product_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'mockup_placement_product_mismatch');
    END IF;
    IF v_variant_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'mockup_placement_variant_mismatch');
    ELSIF v_pl_var_id != v_variant_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'mockup_placement_variant_mismatch');
    END IF;
    IF v_design_id IS NOT NULL AND v_pl_design_id != v_design_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'mockup_placement_design_mismatch');
    END IF;
  END IF;

  v_is_new := NOT EXISTS (SELECT 1 FROM public.product_mockups WHERE id = v_mockup_id);

  INSERT INTO public.product_mockups (
    id, product_id, variant_id, design_id, placement_id, image_url,
    view_type, is_primary, sort_order, status, created_at, updated_at
  )
  VALUES (
    v_mockup_id,
    v_product_id,
    v_variant_id,
    v_design_id,
    v_placement_id,
    v_image_url,
    v_view_type,
    COALESCE((p_mockup->>'isPrimary')::BOOLEAN, false),
    COALESCE((p_mockup->>'sortOrder')::INT, 0),
    v_status,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    product_id = EXCLUDED.product_id,
    variant_id = EXCLUDED.variant_id,
    design_id = EXCLUDED.design_id,
    placement_id = EXCLUDED.placement_id,
    image_url = EXCLUDED.image_url,
    view_type = EXCLUDED.view_type,
    is_primary = EXCLUDED.is_primary,
    sort_order = EXCLUDED.sort_order,
    status = EXCLUDED.status,
    updated_at = now();

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
  VALUES (
    p_admin_id,
    CASE WHEN v_is_new THEN 'mockup_created' ELSE 'mockup_updated' END,
    'product_mockup',
    v_mockup_id::TEXT,
    jsonb_build_object('status', v_status, 'is_primary', COALESCE((p_mockup->>'isPrimary')::BOOLEAN, false))
  );

  RETURN jsonb_build_object('ok', true, 'mockup_id', v_mockup_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.save_mockup_with_audit(JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_mockup_with_audit(JSONB, UUID) TO service_role;

-- 9e. Atomic Mockup Status Transition RPC
CREATE OR REPLACE FUNCTION public.set_mockup_status_with_audit(
  p_mockup_id UUID,
  p_status TEXT,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('draft', 'approved', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Invalid status: %s', p_status));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_mockups WHERE id = p_mockup_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mockup not found');
  END IF;

  UPDATE public.product_mockups
  SET status = p_status, updated_at = now()
  WHERE id = p_mockup_id;

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
  VALUES (
    p_admin_id,
    CASE
      WHEN p_status = 'approved' THEN 'mockup_approved'
      WHEN p_status = 'rejected' THEN 'mockup_rejected'
      ELSE 'mockup_updated'
    END,
    'product_mockup',
    p_mockup_id::TEXT,
    jsonb_build_object('status', p_status)
  );

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.set_mockup_status_with_audit(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_mockup_status_with_audit(UUID, TEXT, UUID) TO service_role;
