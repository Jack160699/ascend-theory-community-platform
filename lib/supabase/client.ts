import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseUrl, getSupabaseAnonKey } from "./env";

export function createSupabaseBrowserClient() {
  const url = getSupabaseUrl() || "https://placeholder-project.supabase.co";
  const anonKey = getSupabaseAnonKey() || "placeholder-anon-key";

  return createBrowserClient(url, anonKey);
}
