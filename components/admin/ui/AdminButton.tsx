import React from "react";
import { clsx } from "clsx";

type AdminButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
};

export function AdminButton({
  children,
  variant = "primary",
  size = "md",
  icon,
  className,
  disabled,
  ...props
}: AdminButtonProps) {
  const baseClasses =
    "inline-flex items-center justify-center font-medium tracking-wide transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-zinc-500/50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg";

  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs gap-1.5",
    md: "px-4 py-2 text-xs sm:text-sm gap-2",
    lg: "px-5 py-2.5 text-sm gap-2.5",
  }[size];

  const variantClasses = {
    primary:
      "bg-zinc-100 text-zinc-900 hover:bg-white active:bg-zinc-200 font-semibold shadow-sm",
    secondary:
      "bg-zinc-800/80 text-zinc-100 hover:bg-zinc-700/80 border border-white/10 active:bg-zinc-800",
    outline:
      "bg-transparent text-zinc-300 border border-white/15 hover:border-white/30 hover:bg-white/5 active:bg-white/10",
    ghost:
      "bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/5 active:bg-white/10",
    danger:
      "bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 active:bg-rose-600/40",
  }[variant];

  return (
    <button
      className={clsx(baseClasses, sizeClasses, variantClasses, className)}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
