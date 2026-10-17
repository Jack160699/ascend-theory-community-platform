import Link from "next/link";
import type { ReactNode } from "react";
import { ORDER_STAGE_LABEL, type OrderStage } from "@/lib/admin/metrics";
import { STAGE_TONE } from "./format";

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-white/[0.08] bg-zinc-950/60 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          {title && <h2 className="text-sm font-medium text-zinc-200">{title}</h2>}
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-zinc-950/60 p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1.5 break-words text-2xl font-semibold tabular-nums text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function StageBadge({ stage }: { stage: OrderStage }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-[11px] ${STAGE_TONE[stage]}`}>
      {ORDER_STAGE_LABEL[stage]}
    </span>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-xs text-zinc-400 underline-offset-4 hover:text-white hover:underline">
      {children}
    </Link>
  );
}

export function Unavailable({ what }: { what: string }) {
  return <p className="text-sm text-rose-300">{what} couldn&apos;t be loaded. Refresh to try again.</p>;
}
