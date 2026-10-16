-- =============================================================================
-- ASCEND THEORY PLATFORM — ADDITIVE MIGRATION (PHASE 4 RLS POLICY SCOPE HOTFIX)
-- Migration: 20260809000005_fix_wearables_rls_policy_scope.sql
-- Description: Restricts Admin RLS policies on products, product_variants, and
--              collections explicitly to 'TO authenticated'.
--              Prevents 'anon' role queries from evaluating policies that invoke
--              public.is_caller_active_admin_with_roles(), eliminating the
--              "permission denied for function is_caller_active_admin_with_roles"
--              error on public/anon requests while keeping helper privileges locked down.
-- =============================================================================

-- 1. Admin Policies: Products
DROP POLICY IF EXISTS "Admin read products" ON public.products;
DROP POLICY IF EXISTS "Admin write products" ON public.products;

CREATE POLICY "Admin read products" ON public.products
  FOR SELECT
  TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write products" ON public.products
  FOR ALL
  TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- 2. Admin Policies: Product Variants
DROP POLICY IF EXISTS "Admin read product variants" ON public.product_variants;
DROP POLICY IF EXISTS "Admin write product variants" ON public.product_variants;

CREATE POLICY "Admin read product variants" ON public.product_variants
  FOR SELECT
  TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write product variants" ON public.product_variants
  FOR ALL
  TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- 3. Admin Policies: Collections
DROP POLICY IF EXISTS "Admin read collections" ON public.collections;
DROP POLICY IF EXISTS "Admin write collections" ON public.collections;

CREATE POLICY "Admin read collections" ON public.collections
  FOR SELECT
  TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor', 'support']));

CREATE POLICY "Admin write collections" ON public.collections
  FOR ALL
  TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));
