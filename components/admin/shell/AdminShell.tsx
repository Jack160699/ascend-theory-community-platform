"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import type { AdminUser } from "@/lib/admin/auth-shared";
import { AdminAuthProvider } from "./AdminAuthContext";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import { AdminMobileNav } from "./AdminMobileNav";

export function AdminShell({ user, children }: { user: AdminUser | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  if (pathname === "/admin/login") {
    return <div className="min-h-screen bg-black text-white">{children}</div>;
  }

  return (
    <AdminAuthProvider user={user}>
      <div className="min-h-screen bg-[#050505] font-sans text-zinc-100 selection:bg-zinc-800 selection:text-white">
        <AdminSidebar />
        <AdminMobileNav isOpen={isMobileNavOpen} onClose={() => setIsMobileNavOpen(false)} />
        <div className="flex min-h-screen flex-col lg:pl-60">
          <AdminHeader onOpenMobileNav={() => setIsMobileNavOpen(true)} />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
        </div>
      </div>
    </AdminAuthProvider>
  );
}
