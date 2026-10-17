import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { validateRedirectUrl } from "@/lib/admin/auth-shared";
import { hasSupabaseConfig, getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Intercept and protect /admin routes
  if (pathname.startsWith("/admin")) {
    // Login page is public
    if (pathname === "/admin/login") {
      return NextResponse.next();
    }

    const isProduction = process.env.NODE_ENV === "production";

    // FAIL CLOSED: In production, missing Supabase configuration immediately blocks /admin
    if (isProduction && !hasSupabaseConfig()) {
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("error", "missing_config");
      return NextResponse.redirect(loginUrl);
    }

    const { supabaseResponse, user } = await updateSession(request);

    // FAIL CLOSED: Unauthenticated user redirection
    if (!user) {
      if (!hasSupabaseConfig() && !isProduction) {
        const sessionCookie = request.cookies.get("ascend_hq_session");
        if (sessionCookie && sessionCookie.value) {
          return supabaseResponse;
        }
      }

      const safeFrom = validateRedirectUrl(pathname, "/admin");
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("from", safeFrom);
      return NextResponse.redirect(loginUrl, { headers: supabaseResponse.headers });
    }

    // FAIL CLOSED: Verify active admin profile membership server-side in middleware
    if (hasSupabaseConfig()) {
      const url = getSupabaseUrl()!;
      const anonKey = getSupabaseAnonKey()!;

      const supabase = createServerClient(url, anonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll() {},
        },
      });

      const { data: profile } = await supabase
        .from("admin_profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile || !profile.is_active) {
        const loginUrl = new URL("/admin/login", request.url);
        loginUrl.searchParams.set("error", "unauthorized_membership");
        return NextResponse.redirect(loginUrl, { headers: supabaseResponse.headers });
      }
    }

    return supabaseResponse;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
