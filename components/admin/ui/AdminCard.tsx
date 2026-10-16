import React from "react";
import { clsx } from "clsx";

type AdminCardProps = {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
  padded?: boolean;
};

export function AdminCard({
  children,
  className,
  hoverable = false,
  padded = true,
}: AdminCardProps) {
  return (
    <div
      className={clsx(
        "relative rounded-xl border border-white/[0.07] bg-zinc-950/80 backdrop-blur-md shadow-lg transition-all duration-200",
        padded && "p-5 sm:p-6",
        hoverable && "hover:border-white/20 hover:bg-zinc-900/60 hover:shadow-xl",
        className
      )}
    >
      {children}
    </div>
  );
}

export function AdminCardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center justify-between gap-4 pb-4 border-b border-white/[0.06] mb-5", className)}>
      {children}
    </div>
  );
}

export function AdminCardTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={clsx("text-base font-medium tracking-tight text-white/90", className)}>
      {children}
    </h3>
  );
}
