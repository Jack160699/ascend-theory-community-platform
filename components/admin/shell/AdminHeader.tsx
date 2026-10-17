"use client";

import { usePathname } from "next/navigation";
import { ExternalLink, LogOut, Menu } from "lucide-react";
import { navItemForPath } from "@/lib/admin/nav";
import { ADMIN_ROLE_DETAILS } from "@/lib/admin/auth-shared";
import { useAdminAuth } from "./AdminAuthContext";

export function AdminHeader({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAdminAuth();
  const current = navItemForPath(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/[0.06] bg-[#050505]/90 px-4 backdrop-blur sm:px-8">
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="-ml-2 rounded-md p-2 text-zinc-400 hover:bg-white/5 hover:text-white lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <h1 className="truncate text-base font-semibold text-white">{current?.label ?? "Ascend HQ"}</h1>

      <div className="ml-auto flex items-center gap-2">
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="hidden items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-white sm:flex"
        >
          View site <ExternalLink className="h-3.5 w-3.5" />
        </a>
        {user && (
          <div className="hidden text-right md:block">
            <div className="text-xs text-zinc-200">{user.email}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{ADMIN_ROLE_DETAILS[user.role].label}</div>
          </div>
        )}
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
