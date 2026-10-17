import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { getOrderRows, ORDER_STAGE_LABEL, type OrderRow, type OrderStage } from "@/lib/admin/metrics";
import { formatDate, formatMoney, shortOrderId } from "@/components/admin/hq/format";
import { StageBadge, Unavailable } from "@/components/admin/hq/ui";

export const dynamic = "force-dynamic";

const FILTERS: (OrderStage | "all")[] = [
  "all",
  "needs_attention",
  "ready_to_send",
  "cod_review",
  "awaiting_payment",
  "in_production",
  "shipped",
  "delivered",
  "cancelled",
];

const NEXT_STEP: Partial<Record<OrderStage, { label: string; href: string }>> = {
  ready_to_send: { label: "Send to Qikink", href: "/admin/wearables/fulfillment" },
  needs_attention: { label: "Open in Fulfilment", href: "/admin/wearables/fulfillment" },
  cod_review: { label: "Review COD", href: "/admin/commerce/cod" },
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string }>;
}) {
  await requireAdmin();
  const { stage: rawStage, q: rawQuery } = await searchParams;
  const stage = FILTERS.includes(rawStage as OrderStage) ? (rawStage as OrderStage | "all") : "all";
  const query = (rawQuery ?? "").trim().toLowerCase();

  let rows: OrderRow[] | null = null;
  try {
    rows = await getOrderRows();
  } catch (err) {
    console.error("[hq-orders] load failed", err);
  }

  const counts = new Map<string, number>();
  rows?.forEach((r) => counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1));

  const visible = (rows ?? []).filter((r) => {
    if (stage !== "all" && r.stage !== stage) return false;
    if (!query) return true;
    return [r.id, r.customerName, r.customerEmail, r.customerPhone, r.trackingNumber ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const href = (s: string) => {
    const p = new URLSearchParams();
    if (s !== "all") p.set("stage", s);
    if (query) p.set("q", query);
    const qs = p.toString();
    return qs ? `/admin/orders?${qs}` : "/admin/orders";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
          {FILTERS.map((f) => {
            const n = f === "all" ? rows?.length ?? 0 : counts.get(f) ?? 0;
            const active = f === stage;
            return (
              <Link
                key={f}
                href={href(f)}
                className={`whitespace-nowrap rounded-full border px-3 py-1 ${
                  active ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-zinc-400 hover:text-white"
                }`}
              >
                {f === "all" ? "All" : ORDER_STAGE_LABEL[f]} <span className="text-zinc-500">{n}</span>
              </Link>
            );
          })}
        </div>
        <form className="flex gap-2" action="/admin/orders">
          {stage !== "all" && <input type="hidden" name="stage" value={stage} />}
          <input
            name="q"
            defaultValue={rawQuery ?? ""}
            placeholder="Name, email, phone, order or AWB"
            className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none sm:w-72"
          />
        </form>
      </div>

      {rows === null ? (
        <Unavailable what="Orders" />
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-white/[0.08] px-4 py-10 text-center text-sm text-zinc-500">
          {rows.length === 0 ? "No orders yet." : "No orders match this filter."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((o) => (
            <li key={o.id}>
              <details className="group rounded-lg border border-white/[0.08] bg-zinc-950/60 open:border-white/20">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-zinc-100">
                      {o.customerName}
                      <span className="ml-2 text-xs text-zinc-500">#{shortOrderId(o.id)}</span>
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {formatDate(o.createdAt)} · {o.units} item{o.units === 1 ? "" : "s"} · {o.paymentLabel}
                    </div>
                  </div>
                  <div className="tabular-nums text-zinc-100">{formatMoney(o.total, o.currency)}</div>
                  <StageBadge stage={o.stage} />
                </summary>

                <div className="grid gap-4 border-t border-white/[0.06] px-4 py-4 text-sm sm:grid-cols-3">
                  <div>
                    <h3 className="mb-1 text-xs text-zinc-500">Items</h3>
                    <ul className="space-y-1">
                      {o.items.map((i, idx) => (
                        <li key={idx} className="flex justify-between gap-3 text-zinc-300">
                          <span>
                            {i.name}
                            {(i.color || i.size) && (
                              <span className="text-zinc-500"> · {[i.color, i.size].filter(Boolean).join(" ")}</span>
                            )}{" "}
                            ×{i.quantity}
                          </span>
                          <span className="tabular-nums">{formatMoney(i.lineTotal, o.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-1 text-xs text-zinc-500">Customer</h3>
                    <p className="text-zinc-300">{o.customerName}</p>
                    {o.customerEmail && <p className="text-zinc-400">{o.customerEmail}</p>}
                    {o.customerPhone && <p className="text-zinc-400">{o.customerPhone}</p>}
                    {o.shipTo && <p className="mt-1 text-xs text-zinc-500">{o.shipTo}</p>}
                  </div>
                  <div>
                    <h3 className="mb-1 text-xs text-zinc-500">Fulfilment</h3>
                    {o.fulfilmentStatus ? (
                      <dl className="space-y-0.5 text-zinc-300">
                        <div>Qikink status: {o.fulfilmentStatus.replaceAll("_", " ").toLowerCase()}</div>
                        {o.providerOrderId && <div className="text-zinc-400">Qikink order {o.providerOrderId}</div>}
                        {o.trackingNumber && (
                          <div className="text-zinc-400">
                            AWB {o.trackingNumber}
                            {o.courierName ? ` · ${o.courierName}` : ""}
                          </div>
                        )}
                        {o.failureMessage && <div className="text-rose-300">{o.failureMessage}</div>}
                      </dl>
                    ) : (
                      <p className="text-zinc-500">Not sent to Qikink yet.</p>
                    )}
                    {NEXT_STEP[o.stage] && (
                      <Link
                        href={NEXT_STEP[o.stage]!.href}
                        className="mt-3 inline-block rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/90"
                      >
                        {NEXT_STEP[o.stage]!.label}
                      </Link>
                    )}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
