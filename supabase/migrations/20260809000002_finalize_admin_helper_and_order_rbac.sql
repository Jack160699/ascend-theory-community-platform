-- =============================================================================
-- ASCEND THEORY PLATFORM — ADDITIVE MIGRATION (PHASE 2 RBAC FINALIZATION)
-- Migration: 20260809000002_finalize_admin_helper_and_order_rbac.sql
-- Description: Refactors all table RLS policies to use auth.uid()-bound helpers.
--              Enforces READ-ONLY access for 'support' role on commerce/orders.
--              Revokes/drops old arbitrary user-id helper functions.
--              Tightens EXECUTE privileges on SECURITY DEFINER functions.
-- =============================================================================

-- 1. Update RLS policies on products, variants, orders, order_items, and audit_logs to use auth.uid()-bound helpers

-- Products & Variants: Active admin with owner/admin/editor roles
DROP POLICY IF EXISTS "Admin full products access" ON public.products;
CREATE POLICY "Admin full products access" ON public.products
  FOR ALL
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor']));

DROP POLICY IF EXISTS "Admin full variants access" ON public.product_variants;
CREATE POLICY "Admin full variants access" ON public.product_variants
  FOR ALL
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'editor']));

-- Orders & Order Items:
-- Support role gets READ-ONLY access.
-- Only Owner & Admin may write/mutate orders.
DROP POLICY IF EXISTS "Admin read orders" ON public.orders;
CREATE POLICY "Admin read orders" ON public.orders
  FOR SELECT
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'support']));

DROP POLICY IF EXISTS "Admin write orders" ON public.orders;
CREATE POLICY "Admin write orders" ON public.orders
  FOR ALL
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admin read order items" ON public.order_items;
CREATE POLICY "Admin read order items" ON public.order_items
  FOR SELECT
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'support']));

DROP POLICY IF EXISTS "Admin write order items" ON public.order_items;
CREATE POLICY "Admin write order items" ON public.order_items
  FOR ALL
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- Audit Logs: Owner & Admin read-only access
DROP POLICY IF EXISTS "Admin read audit logs" ON public.audit_logs;
CREATE POLICY "Admin read audit logs" ON public.audit_logs
  FOR SELECT
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- 2. Revoke execute privileges and drop old arbitrary user-id helper functions
REVOKE EXECUTE ON FUNCTION public.is_active_admin(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_active_admin_with_roles(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.is_active_admin(UUID);
DROP FUNCTION IF EXISTS public.is_active_admin_with_roles(UUID, TEXT[]);

-- 3. Tighten EXECUTE permissions on new auth.uid()-bound SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.get_caller_admin_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_caller_active_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_caller_active_admin_with_roles(TEXT[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_caller_admin_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_caller_active_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_caller_active_admin_with_roles(TEXT[]) TO authenticated, service_role;
