-- =============================================================================
-- ASCEND THEORY PLATFORM — ADDITIVE MIGRATION (PHASE 2 SECURITY HARDENING)
-- Migration: 20260809000001_strictly_enforce_admin_profile_privileges.sql
-- Description: Strictly enforces RBAC privilege boundaries on admin_profiles table.
--              Prevents privilege escalation (admins promoting to owner, modifying/deleting owners).
--              Uses non-recursive SECURITY DEFINER helper bound to auth.uid().
-- =============================================================================

-- 1. Bound SECURITY DEFINER helper functions to auth.uid() to prevent arbitrary role querying
CREATE OR REPLACE FUNCTION public.get_caller_admin_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role
  FROM public.admin_profiles
  WHERE id = auth.uid()
    AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.is_caller_active_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_profiles
    WHERE id = auth.uid()
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_caller_active_admin_with_roles(allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_profiles
    WHERE id = auth.uid()
      AND is_active = true
      AND role = ANY(allowed_roles)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_caller_admin_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_caller_active_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_caller_active_admin_with_roles(TEXT[]) TO authenticated, service_role;

-- 2. Drop prior broad policy on admin_profiles
DROP POLICY IF EXISTS "Super admin manage admin profiles" ON public.admin_profiles;
DROP POLICY IF EXISTS "Admin self read profile" ON public.admin_profiles;

-- 3. Explicit, granular, non-recursive RLS policies for admin_profiles

-- SELECT: Any user can read their own profile; Owners read all; Admins read non-owner profiles
CREATE POLICY "Admin profiles select policy" ON public.admin_profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR public.get_caller_admin_role() = 'owner'
    OR (public.get_caller_admin_role() = 'admin' AND role != 'owner')
  );

-- INSERT: Owner can insert any role; Admin can insert non-owner roles only
CREATE POLICY "Owner insert any admin profile" ON public.admin_profiles
  FOR INSERT
  WITH CHECK (public.get_caller_admin_role() = 'owner');

CREATE POLICY "Admin insert non-owner admin profile" ON public.admin_profiles
  FOR INSERT
  WITH CHECK (
    public.get_caller_admin_role() = 'admin'
    AND role IN ('admin', 'editor', 'support')
  );

-- UPDATE: Owner can update any profile; Admin can update non-owner profiles only to non-owner roles
CREATE POLICY "Owner update any admin profile" ON public.admin_profiles
  FOR UPDATE
  USING (public.get_caller_admin_role() = 'owner')
  WITH CHECK (public.get_caller_admin_role() = 'owner');

CREATE POLICY "Admin update non-owner admin profile" ON public.admin_profiles
  FOR UPDATE
  USING (
    public.get_caller_admin_role() = 'admin'
    AND role != 'owner'
  )
  WITH CHECK (
    public.get_caller_admin_role() = 'admin'
    AND role IN ('admin', 'editor', 'support')
  );

-- DELETE: Owner can delete any profile; Admin can delete non-owner profiles only
CREATE POLICY "Owner delete any admin profile" ON public.admin_profiles
  FOR DELETE
  USING (public.get_caller_admin_role() = 'owner');

CREATE POLICY "Admin delete non-owner admin profile" ON public.admin_profiles
  FOR DELETE
  USING (
    public.get_caller_admin_role() = 'admin'
    AND role != 'owner'
  );
