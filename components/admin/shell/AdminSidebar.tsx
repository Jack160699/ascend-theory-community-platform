"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HQ_NAV, isNavItemActive } from "@/lib/admin/nav";
import { AdminNavIcon } from "./AdminNavIcon";

export function AdminNavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Ascend HQ">
      {HQ_NAV.map((item) => {
        const active = isNavItemActive(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
              active ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
            }`}
          >
            <AdminNavIcon icon={item.icon} className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminBrand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-zinc-900 text-sm font-black">
        A
      </span>
      <span className="text-sm font-semibold tracking-wide text-white">Ascend HQ</span>
    </Link>
  );
}

export function AdminSidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/[0.06] bg-zinc-950 lg:flex">
      <div className="flex h-16 items-center px-5">
        <AdminBrand />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <AdminNavList />
      </div>
    </aside>
  );
}
