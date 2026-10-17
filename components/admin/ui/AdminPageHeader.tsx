import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AdminBadge } from "./AdminBadge";
import { ModuleStatus } from "@/lib/admin/navigation";

type Breadcrumbs = {
  label: string;
  href?: string;
};

type AdminPageHeaderProps = {
  title: string;
  description?: string;
  status?: ModuleStatus;
  badge?: string;
  breadcrumbs?: Breadcrumbs[];
  actions?: React.ReactNode;
};

export function AdminPageHeader({
  title,
  description,
  status,
  badge,
  breadcrumbs = [],
  actions,
}: AdminPageHeaderProps) {
  return (
    <div className="mb-6 sm:mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.06] pb-5 sm:pb-6">
      <div>
        {breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
            <Link href="/admin" className="hover:text-zinc-300 transition-colors">
              Ascend HQ
            </Link>
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={idx}>
                <ChevronRight className="h-3 w-3 text-zinc-600" />
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-zinc-300 transition-colors">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-zinc-400 font-medium">{crumb.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            {title}
          </h1>
          {status && <AdminBadge status={status}>{status.toUpperCase()}</AdminBadge>}
          {badge && <AdminBadge variant="outline">{badge}</AdminBadge>}
        </div>
        {description && (
          <p className="mt-1.5 text-xs sm:text-sm text-zinc-400 max-w-3xl leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
}
