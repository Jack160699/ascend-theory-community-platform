"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { ADMIN_DOMAINS } from "@/lib/admin/navigation";

type AdminMobileNavProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function AdminMobileNav({ isOpen, onClose }: AdminMobileNavProps) {
  const pathname = usePathname();
  const [openDomains, setOpenDomains] = useState<Record<string, boolean>>({
    overview: true,
  });

  if (!isOpen) return null;

  const toggleDomain = (id: string) => {
    setOpenDomains((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-y-0 left-0 w-80 max-w-[85vw] border-r border-white/10 bg-zinc-950 p-4 shadow-2xl overflow-y-auto z-10 flex flex-col">
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
          <Link href="/admin" onClick={onClose} className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-zinc-900 font-extrabold text-xs">
              A
            </div>
            <div>
              <span className="font-bold tracking-tight text-white text-sm flex items-center gap-1">
                ASCEND HQ <Sparkles className="h-3 w-3 text-amber-400" />
              </span>
              <span className="text-[10px] font-mono text-zinc-400 block">Mobile Control Shell</span>
            </div>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-2">
          {ADMIN_DOMAINS.map((domain) => {
            const isDomainOpen = openDomains[domain.id];
            return (
              <div key={domain.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleDomain(domain.id)}
                  className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/5"
                >
                  <span className="tracking-wide text-white">{domain.title}</span>
                  {isDomainOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                  )}
                </button>

                {isDomainOpen && (
                  <div className="ml-3 border-l border-white/10 pl-3 space-y-1 py-1">
                    {domain.modules.map((mod) => {
                      const isActive = pathname === mod.href;
                      return (
                        <Link
                          key={mod.id}
                          href={mod.href}
                          onClick={onClose}
                          className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                            isActive
                              ? "bg-emerald-500/10 text-emerald-300 font-semibold border border-emerald-500/20"
                              : "text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          <span>{mod.title}</span>
                          {mod.status && (
                            <span className="text-[9px] font-mono uppercase text-zinc-500">
                              {mod.status}
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

        <div className="mt-6 pt-4 border-t border-white/10 text-center">
          <span className="text-[10px] font-mono text-zinc-500">
            Ascend Theory Platform HQ Phase 1
          </span>
        </div>
      </div>
    </div>
  );
}
