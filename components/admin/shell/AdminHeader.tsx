"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import {
  Search,
  Bell,
  Menu,
  LogOut,
  User as UserIcon,
  Activity,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { getModuleByPath } from "@/lib/admin/navigation";
import { useAdminAuth } from "./AdminAuthContext";
import { AdminRoleBadge } from "../ui/AdminRoleBadge";
import { AdminSearchModal } from "../ui/AdminSearchModal";

type AdminHeaderProps = {
  onOpenMobileNav: () => void;
};

export function AdminHeader({ onOpenMobileNav }: AdminHeaderProps) {
  const pathname = usePathname();
  const { user, logout } = useAdminAuth();
  const { domain, module } = getModuleByPath(pathname);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const sampleNotifications = [
    { id: "1", title: "New Order #AT-9842", time: "5m ago", type: "order" },
    { id: "2", title: "Member #2480 joined Community", time: "18m ago", type: "user" },
    { id: "3", title: "Qikink POD sync verification OK", time: "1h ago", type: "system" },
  ];

  return (
    <>
      <header className="sticky top-0 z-20 flex h-16 w-full items-center justify-between border-b border-white/[0.07] bg-zinc-950/80 px-4 sm:px-6 backdrop-blur-xl">
        {/* Left Side: Mobile Menu Button & Breadcrumb */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenMobileNav}
            className="lg:hidden text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5"
            aria-label="Open mobile navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className="font-semibold text-white tracking-tight">Ascend HQ</span>
              <span>/</span>
              <span>{domain?.title ?? "Overview"}</span>
            </div>
            <h2 className="text-sm font-bold text-white tracking-tight leading-none hidden sm:block">
              {module?.title ?? "Dashboard"}
            </h2>
          </div>
        </div>

        {/* Center: Global Search Bar */}
        <div className="hidden md:flex flex-1 max-w-md mx-6">
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-400 hover:border-white/20 hover:bg-zinc-900 transition-all shadow-inner"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              <span>Search HQ modules, settings, actions...</span>
            </div>
            <span className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
              Ctrl + K
            </span>
          </button>
        </div>

        {/* Right Side: Quick Action Indicators & User Session */}
        <div className="flex items-center gap-2.5">
          {/* Mobile search trigger */}
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="md:hidden text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-white/5"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Live System Beacon */}
          <div className="hidden xl:flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>HQ Systems Normal</span>
          </div>

          {/* Public Site Link */}
          <Link
            href="/"
            target="_blank"
            className="hidden sm:flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-white hover:border-white/20 transition-colors"
            title="View Public Store Front"
          >
            <span>Live Site</span>
            <ExternalLink className="h-3 w-3 text-zinc-500" />
          </Link>

          {/* RBAC Role Switcher */}
          <AdminRoleBadge />

          {/* Notifications Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className="relative rounded-lg border border-white/10 bg-zinc-900 p-2 text-zinc-400 hover:text-white hover:border-white/20 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-zinc-950">
                3
              </span>
            </button>

            {isNotifOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsNotifOpen(false)} />
                <div className="absolute right-0 mt-2 z-50 w-72 sm:w-80 rounded-xl border border-white/10 bg-zinc-950 p-3 shadow-2xl backdrop-blur-xl">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-emerald-400" /> Notifications
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">Real-time HQ Feed</span>
                  </div>

                  <div className="space-y-2">
                    {sampleNotifications.map((n) => (
                      <div
                        key={n.id}
                        className="flex items-start justify-between rounded-lg border border-white/5 bg-zinc-900/60 p-2.5 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-zinc-200">{n.title}</div>
                          <div className="text-[10px] text-zinc-500">{n.time}</div>
                        </div>
                        <span className="h-2 w-2 rounded-full bg-emerald-400 mt-1" />
                      </div>
                    ))}
                  </div>

                  <Link
                    href="/admin/overview/notifications"
                    onClick={() => setIsNotifOpen(false)}
                    className="block mt-3 text-center text-xs text-zinc-400 hover:text-white font-medium"
                  >
                    View All Activity Log &rarr;
                  </Link>
                </div>
              </>
            )}
          </div>

          {/* User Profile & Logout */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900 p-1.5 pl-2 text-xs hover:border-white/20 transition-colors"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-zinc-800 text-zinc-200 font-bold text-[10px]">
                {user?.name ? user.name.slice(0, 2).toUpperCase() : "HQ"}
              </div>
              <span className="hidden md:inline font-semibold text-white truncate max-w-[90px]">
                {user?.name ?? "Admin"}
              </span>
            </button>

            {isUserMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                <div className="absolute right-0 mt-2 z-50 w-56 rounded-xl border border-white/10 bg-zinc-950 p-2 shadow-2xl">
                  <div className="p-2 border-b border-white/5 mb-1">
                    <p className="text-xs font-semibold text-white">{user?.name}</p>
                    <p className="text-[11px] text-zinc-500 truncate">{user?.email}</p>
                  </div>

                  <div className="space-y-0.5">
                    <Link
                      href="/admin/system/users"
                      onClick={() => setIsUserMenuOpen(false)}
                      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/5 hover:text-white"
                    >
                      <UserIcon className="h-3.5 w-3.5 text-zinc-400" /> Account Settings
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10"
                    >
                      <LogOut className="h-3.5 w-3.5" /> Log Out of Ascend HQ
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Global Search Modal */}
      <AdminSearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </>
  );
}
