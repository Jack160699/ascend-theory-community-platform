/**
 * Supabase Environment Configuration & Safe Validation.
 */

export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getSupabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function getSupabaseServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Returns true if public Supabase credentials are available.
 */
export function hasSupabaseConfig(): boolean {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  return Boolean(url && key && url.trim().length > 0 && key.trim().length > 0);
}

/**
 * Returns true if service role secret key is available on the server.
 */
export function hasSupabaseServiceConfig(): boolean {
  const url = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();
  return Boolean(
    url && serviceKey && url.trim().length > 0 && serviceKey.trim().length > 0
  );
}

/**
 * Validates Supabase environment variables for server execution.
 * Throws explicit error in production if keys are missing.
 */
export function validateSupabaseEnv(isProduction: boolean = process.env.NODE_ENV === "production"): void {
  if (isProduction && !hasSupabaseConfig()) {
    throw new Error(
      "[ASCEND HQ CRITICAL] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured in production."
    );
  }
}
