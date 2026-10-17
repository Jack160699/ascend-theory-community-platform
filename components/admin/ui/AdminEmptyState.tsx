import React from "react";
import { FolderOpen } from "lucide-react";
import { AdminButton } from "./AdminButton";

type AdminEmptyStateProps = {
  title: string;
  description: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  badge?: string;
};

export function AdminEmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  badge,
}: AdminEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-zinc-950/40 p-8 sm:p-12 text-center my-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/80 text-zinc-400 mb-4 shadow-inner">
        {icon || <FolderOpen className="h-7 w-7 text-zinc-400" />}
      </div>
      {badge && (
        <span className="mb-2 rounded-full border border-zinc-700 bg-zinc-800/80 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300">
          {badge}
        </span>
      )}
      <h3 className="text-base sm:text-lg font-semibold text-white tracking-tight">
        {title}
      </h3>
      <p className="mt-1.5 max-w-md text-xs sm:text-sm text-zinc-400 leading-relaxed">
        {description}
      </p>
      {actionLabel && (
        <div className="mt-6">
          <AdminButton variant="primary" onClick={onAction}>
            {actionLabel}
          </AdminButton>
        </div>
      )}
    </div>
  );
}
