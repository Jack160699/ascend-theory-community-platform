"use client";

import { X } from "lucide-react";
import { AdminBrand, AdminNavList } from "./AdminSidebar";

export function AdminMobileNav({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-white/10 bg-zinc-950">
        <div className="flex h-16 items-center justify-between px-5">
          <AdminBrand />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <AdminNavList onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}
