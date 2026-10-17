-- =============================================================================
-- ASCEND THEORY PLATFORM — ADDITIVE MIGRATION (PHASE 2 SECURITY HARDENING)
-- Migration: 20260809000000_fix_admin_profiles_rls.sql
-- Description: Fixes admin_profiles RLS policy recursion using non-recursive
--              SECURITY DEFINER helper functions. Prevents privilege escalation.
-- =============================================================================

-- 1. Non-recursive SECURITY DEFINER helper function for role checks
CREATE OR REPLACE FUNCTION public.is_active_admin_with_roles(user_id UUID, allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_profiles
    WHERE id = user_id
      AND is_active = true
      AND role = ANY(allowed_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_admin(user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_profiles
    WHERE id = user_id
      AND is_active = true
  );
$$;

-- Grant execute privileges to authenticated & service_role
GRANT EXECUTE ON FUNCTION public.is_active_admin_with_roles(UUID, TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_admin(UUID) TO authenticated, service_role;

-- 2. Drop existing recursive policies on admin_profiles
DROP POLICY IF EXISTS "Super admin full profile access" ON public.admin_profiles;
DROP POLICY IF EXISTS "Admin self read profile" ON public.admin_profiles;

-- Re-create safe non-recursive policies on admin_profiles
CREATE POLICY "Admin self read profile" ON public.admin_profiles
  FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Super admin manage admin profiles" ON public.admin_profiles
  FOR ALL
  USING (public.is_active_admin_with_roles(auth.uid(), ARRAY['owner', 'admin']));

-- 3. Refactor dependent RLS policies to use helper functions (non-recursive)
DROP POLICY IF EXISTS "Admin full products access" ON public.products;
CREATE POLICY "Admin full products access" ON public.products
  FOR ALL
  USING (public.is_active_admin(auth.uid()));

DROP POLICY IF EXISTS "Admin full variants access" ON public.product_variants;
CREATE POLICY "Admin full variants access" ON public.product_variants
  FOR ALL
  USING (public.is_active_admin(auth.uid()));

DROP POLICY IF EXISTS "Admin read orders" ON public.orders;
CREATE POLICY "Admin read orders" ON public.orders
  FOR SELECT
  USING (public.is_active_admin(auth.uid()));

DROP POLICY IF EXISTS "Admin write orders" ON public.orders;
CREATE POLICY "Admin write orders" ON public.orders
  FOR ALL
  USING (public.is_active_admin_with_roles(auth.uid(), ARRAY['owner', 'admin', 'support']));

DROP POLICY IF EXISTS "Admin read order items" ON public.order_items;
CREATE POLICY "Admin read order items" ON public.order_items
  FOR SELECT
  USING (public.is_active_admin(auth.uid()));

DROP POLICY IF EXISTS "Admin read audit logs" ON public.audit_logs;
CREATE POLICY "Admin read audit logs" ON public.audit_logs
  FOR SELECT
  USING (public.is_active_admin_with_roles(auth.uid(), ARRAY['owner', 'admin']));
