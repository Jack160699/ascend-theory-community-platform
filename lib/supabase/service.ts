import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getSupabaseServiceRoleKey, hasSupabaseServiceConfig } from "./env";

export function createSupabaseServiceClient() {
  if (!hasSupabaseServiceConfig()) {
    return null;
  }

  const url = getSupabaseUrl()!;
  const serviceKey = getSupabaseServiceRoleKey()!;

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
