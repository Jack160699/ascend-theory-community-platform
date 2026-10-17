"use client";

import React, { createContext, useContext, useState } from "react";
import { AdminUser, AdminRole, DEFAULT_ADMIN_USER } from "@/lib/admin/auth-shared";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { hasSupabaseConfig } from "@/lib/supabase/env";

type AdminAuthContextType = {
  user: AdminUser | null;
  setRole: (role: AdminRole) => void;
  logout: () => void;
};

const AdminAuthContext = createContext<AdminAuthContextType>({
  user: DEFAULT_ADMIN_USER,
  setRole: () => {},
  logout: () => {},
});

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const isDev = process.env.NODE_ENV === "development";

  const [user, setUser] = useState<AdminUser | null>(() => {
    if (typeof window === "undefined") return DEFAULT_ADMIN_USER;
    if (isDev) {
      try {
        const savedRole = localStorage.getItem("ascend_hq_active_role") as AdminRole | null;
        if (savedRole && ["owner", "admin", "editor", "support"].includes(savedRole)) {
          return { ...DEFAULT_ADMIN_USER, role: savedRole };
        }
      } catch {
        /* ignore */
      }
    }
    return DEFAULT_ADMIN_USER;
  });

  const router = useRouter();

  const handleSetRole = (role: AdminRole) => {
    if (!isDev) return; // Role switcher disabled in production
    try {
      localStorage.setItem("ascend_hq_active_role", role);
    } catch {
      /* ignore */
    }
    setUser((prev) => (prev ? { ...prev, role } : null));
  };

  const handleLogout = async () => {
    try {
      if (hasSupabaseConfig()) {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
      }
    } catch {
      /* ignore */
    }

    document.cookie = "ascend_hq_session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    localStorage.removeItem("ascend_hq_active_role");
    setUser(null);
    router.push("/admin/login");
    router.refresh();
  };

  return (
    <AdminAuthContext.Provider
      value={{
        user,
        setRole: handleSetRole,
        logout: handleLogout,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}
