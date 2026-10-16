import React from "react";
import { clsx } from "clsx";
import { ModuleStatus } from "@/lib/admin/navigation";

type AdminBadgeProps = {
  children: React.ReactNode;
  variant?: "default" | "status" | "success" | "warning" | "danger" | "info" | "outline";
  status?: ModuleStatus;
  className?: string;
  size?: "sm" | "md";
};

export function AdminBadge({
  children,
  variant = "default",
  status,
  className,
  size = "md",
}: AdminBadgeProps) {
  let styleClasses = "bg-white/10 text-white/80 border-white/10";

  if (status) {
    switch (status) {
      case "active":
        styleClasses = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
        break;
      case "beta":
        styleClasses = "bg-amber-500/10 text-amber-400 border-amber-500/20";
        break;
      case "planned":
        styleClasses = "bg-blue-500/10 text-blue-400 border-blue-500/20";
        break;
      case "maintenance":
        styleClasses = "bg-rose-500/10 text-rose-400 border-rose-500/20";
        break;
    }
  } else {
    switch (variant) {
      case "success":
        styleClasses = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
        break;
      case "warning":
        styleClasses = "bg-amber-500/10 text-amber-400 border-amber-500/20";
        break;
      case "danger":
        styleClasses = "bg-rose-500/10 text-rose-400 border-rose-500/20";
        break;
      case "info":
        styleClasses = "bg-sky-500/10 text-sky-400 border-sky-500/20";
        break;
      case "outline":
        styleClasses = "bg-transparent text-zinc-400 border-white/15";
        break;
    }
  }

  const sizeClasses = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 font-medium tracking-wide rounded-md border",
        sizeClasses,
        styleClasses,
        className
      )}
    >
      {children}
    </span>
  );
}
