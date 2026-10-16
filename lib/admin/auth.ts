import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { redirect } from "next/navigation";
import { AdminRole, AdminUser, DEFAULT_ADMIN_USER, hasMinimumRole } from "./auth-shared";

export * from "./auth-shared";

/**
 * Retrieves the active server-side admin user & profile using Supabase SSR auth.
 * FAIL CLOSED: Returns null unless Supabase user is authenticated, a matching
 * admin_profiles row exists, is_active is true, and role is valid.
 */
export async function getAdminSession(): Promise<AdminUser | null> {
  const isDev = process.env.NODE_ENV === "development";

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Unauthenticated user check
    if (!user) {
      if (isDev && !hasSupabaseConfig()) {
        return DEFAULT_ADMIN_USER;
      }
      return null;
    }

    // Fetch matching admin_profile record
    let profile: { full_name: string; role: string; is_active: boolean } | null = null;
    const serviceClient = createSupabaseServiceClient();

    if (serviceClient) {
      const { data } = await serviceClient
        .from("admin_profiles")
        .select("full_name, role, is_active")
        .eq("id", user.id)
        .maybeSingle();
      profile = data;
    } else {
      const { data } = await supabase
        .from("admin_profiles")
        .select("full_name, role, is_active")
        .eq("id", user.id)
        .maybeSingle();
      profile = data;
    }

    // FAIL CLOSED: Require active admin profile row
    if (!profile || !profile.is_active) {
      return null;
    }

    // FAIL CLOSED: Validate role enum
    const validRoles: AdminRole[] = ["owner", "admin", "editor", "support"];
    if (!validRoles.includes(profile.role as AdminRole)) {
      return null;
    }

    return {
      id: user.id,
      email: user.email || "",
      name: profile.full_name || user.email?.split("@")[0] || "Admin",
      role: profile.role as AdminRole,
      lastActiveAt: new Date().toISOString(),
    };
  } catch {
    if (isDev && !hasSupabaseConfig()) {
      return DEFAULT_ADMIN_USER;
    }
    return null;
  }
}

/**
 * Server guard requiring an authenticated admin session. Redirects to login if unauthenticated or non-admin.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdminSession();
  if (!admin) {
    redirect("/admin/login");
  }
  return admin;
}

/**
 * Server guard requiring a minimum role rank.
 */
export async function requireRole(requiredRole: AdminRole): Promise<AdminUser> {
  const admin = await requireAdmin();
  if (!hasMinimumRole(admin.role, requiredRole)) {
    redirect("/admin?error=unauthorized_role");
  }
  return admin;
}
