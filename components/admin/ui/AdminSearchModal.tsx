"use client";

import React, { useState, useEffect } from "react";
import { Search, X, ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { getAllModules, ADMIN_DOMAINS } from "@/lib/admin/navigation";
import { AdminBadge } from "./AdminBadge";

type AdminSearchModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function AdminSearchModal({ isOpen, onClose }: AdminSearchModalProps) {
  const [query, setQuery] = useState("");
  const allModules = getAllModules();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredModules = query.trim() === ""
    ? allModules.slice(0, 12)
    : allModules.filter(
        (m) =>
          m.title.toLowerCase().includes(query.toLowerCase()) ||
          m.description.toLowerCase().includes(query.toLowerCase()) ||
          m.id.toLowerCase().includes(query.toLowerCase())
      );

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-16 sm:pt-24 px-4">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 shadow-2xl z-10 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
          <Search className="h-5 w-5 text-zinc-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all Ascend HQ modules, settings, or actions..."
            className="w-full bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <span className="rounded border border-white/10 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
            ESC
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-zinc-500 flex items-center justify-between">
            <span>{query ? `Search Results (${filteredModules.length})` : "Suggested HQ Modules"}</span>
            <span className="flex items-center gap-1 text-zinc-400"><Sparkles className="h-3 w-3" /> Ascend Theory Unified HQ</span>
          </div>

          <div className="space-y-1">
            {filteredModules.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">
                No matching modules found for &quot;{query}&quot;
              </div>
            ) : (
              filteredModules.map((mod) => {
                const parentDomain = ADMIN_DOMAINS.find((d) =>
                  d.modules.some((m) => m.id === mod.id)
                );
                return (
                  <Link
                    key={mod.href}
                    href={mod.href}
                    onClick={onClose}
                    className="flex items-center justify-between rounded-xl p-3 text-xs transition-colors hover:bg-white/5 group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-zinc-900 text-zinc-400 group-hover:border-white/20 group-hover:text-white">
                        <ChevronRight className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white group-hover:text-emerald-400 transition-colors">
                            {mod.title}
                          </span>
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {parentDomain?.title}
                          </span>
                          <AdminBadge status={mod.status} size="sm">
                            {mod.status}
                          </AdminBadge>
                        </div>
                        <p className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">
                          {mod.description}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-600 group-hover:text-zinc-400 shrink-0 ml-2">
                      {mod.href}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/10 bg-zinc-900/50 px-4 py-2 text-[11px] text-zinc-500">
          <span>Navigate with mouse or arrow keys</span>
          <span>Ascend Theory Unified Control Center</span>
        </div>
      </div>
    </div>
  );
}
