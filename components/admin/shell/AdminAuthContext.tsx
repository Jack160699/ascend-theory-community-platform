"use client";

import React, { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminUser } from "@/lib/admin/auth-shared";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { hasSupabaseConfig } from "@/lib/supabase/env";

type AdminAuthContextType = {
  user: AdminUser | null;
  logout: () => void;
};

const AdminAuthContext = createContext<AdminAuthContextType>({ user: null, logout: () => {} });

/** Holds the signed-in admin resolved on the server (no placeholder identities). */
export function AdminAuthProvider({ user: initialUser, children }: { user: AdminUser | null; children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(initialUser);
  const router = useRouter();

  const logout = async () => {
    try {
      if (hasSupabaseConfig()) {
        await createSupabaseBrowserClient().auth.signOut();
      }
    } catch {
      /* ignore */
    }
    document.cookie = "ascend_hq_session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    setUser(null);
    router.push("/admin/login");
    router.refresh();
  };

  return <AdminAuthContext.Provider value={{ user, logout }}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}
