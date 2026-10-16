"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Globe,
  BookOpen,
  Users,
  Crown,
  Shirt,
  ShoppingBag,
  Truck,
  Megaphone,
  TrendingUp,
  Settings,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from "lucide-react";
import { ADMIN_DOMAINS, AdminDomainSection } from "@/lib/admin/navigation";
import { AdminBadge } from "../ui/AdminBadge";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Globe,
  BookOpen,
  Users,
  Crown,
  Shirt,
  ShoppingBag,
  Truck,
  Megaphone,
  TrendingUp,
  Settings,
};

type AdminSidebarProps = {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
};

export function AdminSidebar({ isCollapsed, onToggleCollapse }: AdminSidebarProps) {
  const pathname = usePathname();
  
  // Track open domain collapsibles (default open domain matching current URL)
  const activeDomainId = ADMIN_DOMAINS.find((d) =>
    d.modules.some((m) => {
      const href = m.href;
      return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
    })
  )?.id || "overview";

  const [openDomainIds, setOpenDomainIds] = useState<Record<string, boolean>>({
    [activeDomainId]: true,
    overview: true,
  });

  const toggleDomain = (id: string) => {
    setOpenDomainIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <aside
      className={`fixed top-0 left-0 bottom-0 z-30 flex flex-col border-r border-white/[0.07] bg-zinc-950/95 backdrop-blur-xl transition-all duration-300 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between border-b border-white/[0.07] px-4 shrink-0">
        <Link href="/admin" className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-900 font-extrabold text-xs shadow-md shrink-0">
            A
          </div>
          {!isCollapsed && (
            <div className="flex flex-col">
              <span className="font-bold tracking-tight text-white text-sm leading-none flex items-center gap-1">
                ASCEND HQ <Sparkles className="h-3 w-3 text-amber-400" />
              </span>
              <span className="text-[10px] font-mono tracking-widest text-zinc-400 mt-1">
                UNIFIED CONTROL
              </span>
            </div>
          )}
        </Link>

        <button
          type="button"
          onClick={onToggleCollapse}
          className="text-zinc-500 hover:text-zinc-300 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation Domains List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2 custom-scrollbar">
        {ADMIN_DOMAINS.map((domain: AdminDomainSection) => {
          const Icon = ICON_MAP[domain.iconName] || LayoutDashboard;
          const isOpen = openDomainIds[domain.id];
          const isDomainActive = domain.modules.some((m) => {
            const href = m.href;
            return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
          });

          return (
            <div key={domain.id} className="space-y-1">
              {/* Domain Header Button */}
              <button
                type="button"
                onClick={() => toggleDomain(domain.id)}
                className={`w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-xs font-semibold transition-all duration-150 ${
                  isDomainActive
                    ? "bg-white/[0.08] text-white"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                }`}
                title={isCollapsed ? domain.title : undefined}
              >
                <div className="flex items-center gap-2.5 shrink-0">
                  <Icon className={`h-4 w-4 ${isDomainActive ? "text-emerald-400" : "text-zinc-400"}`} />
                  {!isCollapsed && <span className="tracking-tight">{domain.title}</span>}
                </div>

                {!isCollapsed && (
                  <div className="flex items-center gap-1.5">
                    {domain.badge && (
                      <AdminBadge variant="outline" size="sm">
                        {domain.badge}
                      </AdminBadge>
                    )}
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                    )}
                  </div>
                )}
              </button>

              {/* Sub-modules List */}
              {(!isCollapsed && isOpen) && (
                <div className="ml-4 pl-3.5 border-l border-white/[0.08] space-y-0.5 py-1">
                  {domain.modules.map((mod) => {
                    const isModActive =
                      mod.href === "/admin"
                        ? pathname === "/admin"
                        : pathname === mod.href || pathname.startsWith(`${mod.href}/`);

                    return (
                      <Link
                        key={mod.id}
                        href={mod.href}
                        className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                          isModActive
                            ? "bg-emerald-500/10 text-emerald-300 font-semibold border border-emerald-500/20"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                        }`}
                      >
                        <span className="truncate">{mod.title}</span>
                        {mod.badge && (
                          <span className="text-[9px] font-mono uppercase bg-white/10 px-1.5 py-0.5 rounded text-zinc-300">
                            {mod.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer / System Status */}
      {!isCollapsed && (
        <div className="p-3 border-t border-white/[0.07] bg-zinc-900/40">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-[11px] font-medium text-emerald-300">
              Ascend HQ Phase 1 Operational
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
