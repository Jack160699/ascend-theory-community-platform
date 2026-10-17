import type { MoneyByCurrency, OrderStage } from "@/lib/admin/metrics";

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** "$1,320 · ₹4,500" — one figure per currency actually received. */
export function formatMoneyMap(map: MoneyByCurrency): string {
  const entries = Object.entries(map).filter(([, v]) => v > 0);
  if (entries.length === 0) return "0";
  return entries.map(([c, v]) => formatMoney(v, c)).join(" · ");
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shortOrderId(id: string): string {
  return id.replace(/^ASCEND-ORD-/i, "").slice(-10).toUpperCase();
}

export const STAGE_TONE: Record<OrderStage, string> = {
  awaiting_payment: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
  cod_review: "text-amber-300 bg-amber-500/10 border-amber-500/20",
  ready_to_send: "text-sky-300 bg-sky-500/10 border-sky-500/20",
  in_production: "text-violet-300 bg-violet-500/10 border-violet-500/20",
  shipped: "text-indigo-300 bg-indigo-500/10 border-indigo-500/20",
  delivered: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  needs_attention: "text-rose-300 bg-rose-500/10 border-rose-500/20",
  cancelled: "text-zinc-500 bg-zinc-500/5 border-zinc-500/15",
};
