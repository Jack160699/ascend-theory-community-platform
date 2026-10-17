import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { AdminCard } from "./AdminCard";

type AdminStatCardProps = {
  title: string;
  value: string | number;
  change?: string;
  trend?: "up" | "down" | "neutral";
  subtext?: string;
  icon?: React.ReactNode;
};

export function AdminStatCard({
  title,
  value,
  change,
  trend = "neutral",
  subtext,
  icon,
}: AdminStatCardProps) {
  return (
    <AdminCard hoverable className="flex flex-col justify-between">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          {title}
        </span>
        {icon && (
          <div className="rounded-lg border border-white/10 bg-zinc-900 p-2 text-zinc-300">
            {icon}
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white font-mono">
          {value}
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs">
          {change && (
            <span
              className={`inline-flex items-center gap-1 font-semibold ${
                trend === "up"
                  ? "text-emerald-400"
                  : trend === "down"
                  ? "text-rose-400"
                  : "text-zinc-400"
              }`}
            >
              {trend === "up" && <TrendingUp className="h-3 w-3" />}
              {trend === "down" && <TrendingDown className="h-3 w-3" />}
              {trend === "neutral" && <Minus className="h-3 w-3" />}
              {change}
            </span>
          )}
          {subtext && <span className="text-zinc-500">{subtext}</span>}
        </div>
      </div>
    </AdminCard>
  );
}
