"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { AdminAuthProvider } from "./AdminAuthContext";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import { AdminMobileNav } from "./AdminMobileNav";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Do not render HQ shell on the login page
  if (pathname === "/admin/login") {
    return <div className="min-h-screen bg-black text-white">{children}</div>;
  }

  return (
    <AdminAuthProvider>
      <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white flex flex-col">
        {/* Desktop Navigation Sidebar */}
        <div className="hidden lg:block">
          <AdminSidebar
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />
        </div>

        {/* Mobile Slide-Over Navigation */}
        <AdminMobileNav
          isOpen={isMobileNavOpen}
          onClose={() => setIsMobileNavOpen(false)}
        />

        {/* Main Content Area */}
        <div
          className={`flex flex-1 flex-col transition-all duration-300 ${
            isSidebarCollapsed ? "lg:pl-16" : "lg:pl-64"
          }`}
        >
          {/* Header Bar */}
          <AdminHeader onOpenMobileNav={() => setIsMobileNavOpen(true)} />

          {/* Main View Container */}
          <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8 max-w-7xl w-full mx-auto">
            {children}
          </main>

          {/* Minimal HQ Footer */}
          <footer className="border-t border-white/[0.06] bg-zinc-950/60 px-6 py-4 text-center text-xs text-zinc-500 font-mono">
            ASCEND HQ &mdash; Unified Platform Administration Center &bull; Phase 1
          </footer>
        </div>
      </div>
    </AdminAuthProvider>
  );
}
