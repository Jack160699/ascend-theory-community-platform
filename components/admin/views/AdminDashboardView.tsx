import Link from "next/link";
import { ORDER_STAGE_LABEL, type HqMetrics, type OrderStage } from "@/lib/admin/metrics";
import { formatDate, formatMoney, formatMoneyMap, shortOrderId, STAGE_TONE } from "@/components/admin/hq/format";
import { Panel, StageBadge, Stat, TextLink, Unavailable } from "@/components/admin/hq/ui";

const STAGE_ORDER: OrderStage[] = [
  "needs_attention",
  "ready_to_send",
  "cod_review",
  "awaiting_payment",
  "in_production",
  "shipped",
  "delivered",
  "cancelled",
];

export function AdminDashboardView({ metrics: m }: { metrics: HqMetrics }) {
  const q = m.qikink;
  const skuGap =
    q.linkedVariants !== null && q.sellableVariants !== null ? q.sellableVariants - q.linkedVariants : null;

  return (
    <div className="space-y-6">
      {m.errors.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Couldn&apos;t load: {m.errors.join(", ")}. The other figures are accurate.
        </div>
      )}

      {/* Sales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Revenue this month"
          value={m.revenue ? formatMoneyMap(m.revenue.thisMonth) : "—"}
          hint="Paid online + delivered COD"
        />
        <Stat label="Revenue all time" value={m.revenue ? formatMoneyMap(m.revenue.allTime) : "—"} />
        <Stat
          label="Paid orders"
          value={m.revenue ? m.revenue.paidOrders : "—"}
          hint={m.totalOrders !== null ? `${m.totalOrders} orders placed in total` : undefined}
        />
        <Stat label="Tees sold" value={m.revenue ? m.revenue.unitsSold : "—"} />
      </div>

      {/* Pipeline */}
      <Panel title="Where orders are" action={<TextLink href="/admin/orders">All orders</TextLink>}>
        {m.stages ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STAGE_ORDER.map((stage) => (
              <Link
                key={stage}
                href={`/admin/orders?stage=${stage}`}
                className={`rounded-md border px-3 py-2.5 transition hover:brightness-125 ${
                  m.stages![stage] > 0 ? STAGE_TONE[stage] : "border-white/[0.06] text-zinc-600"
                }`}
              >
                <div className="text-xl font-semibold tabular-nums">{m.stages![stage]}</div>
                <div className="text-xs">{ORDER_STAGE_LABEL[stage]}</div>
              </Link>
            ))}
          </div>
        ) : (
          <Unavailable what="Orders" />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent orders */}
        <Panel title="Latest orders" className="lg:col-span-2" action={<TextLink href="/admin/orders">View all</TextLink>}>
          {m.totalOrders === null ? (
            <Unavailable what="Orders" />
          ) : m.recentOrders.length === 0 ? (
            <p className="text-sm text-zinc-500">No orders yet. They appear here the moment someone checks out.</p>
          ) : (
            <ul className="-my-2 divide-y divide-white/[0.06]">
              {m.recentOrders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-zinc-100">{o.customerName}</div>
                    <div className="truncate text-xs text-zinc-500">
                      #{shortOrderId(o.id)} · {formatDate(o.createdAt)} ·{" "}
                      {o.items.map((i) => `${i.name}${i.size ? ` (${i.size})` : ""} ×${i.quantity}`).join(", ")}
                    </div>
                  </div>
                  <div className="tabular-nums text-zinc-200">{formatMoney(o.total, o.currency)}</div>
                  <StageBadge stage={o.stage} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          {/* Qikink */}
          <Panel title="Qikink" action={<TextLink href="/admin/wearables/fulfillment">Open</TextLink>}>
            <dl className="space-y-2 text-sm">
              <Row label="Connection" value={q.credentialsSet ? "Keys set" : "No secret in Vercel"} ok={q.credentialsSet} />
              <Row label="Account" value={q.environment === "live" ? "Live" : "Sandbox (test)"} ok={q.environment === "live"} />
              <Row
                label="Paid orders sent automatically"
                value={q.sendingEnabled && q.autoSubmit ? "Yes" : "No — send from Fulfilment"}
                ok={q.sendingEnabled && q.autoSubmit}
              />
              <Row
                label="Sizes linked to a Qikink SKU"
                value={q.linkedVariants !== null && q.sellableVariants !== null ? `${q.linkedVariants} of ${q.sellableVariants}` : "—"}
                ok={skuGap === 0}
              />
            </dl>
            {skuGap !== null && skuGap > 0 && (
              <p className="mt-3 text-xs text-amber-300">
                {skuGap} size{skuGap === 1 ? "" : "s"} can&apos;t be sent to Qikink yet.{" "}
                <Link href="/admin/wearables/pod-mapping" className="underline underline-offset-4">
                  Link SKUs
                </Link>
              </p>
            )}
          </Panel>

          {/* Stock */}
          <Panel title="Stock" action={<TextLink href="/admin/wearables/products">Products</TextLink>}>
            {m.catalogue ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Mini label="Live products" value={m.catalogue.activeProducts} />
                  <Mini label="Low (≤5)" value={m.catalogue.lowStock} warn={m.catalogue.lowStock > 0} />
                  <Mini label="Sold out" value={m.catalogue.outOfStock} warn={m.catalogue.outOfStock > 0} />
                </div>
                {m.catalogue.alerts.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-xs">
                    {m.catalogue.alerts.map((a) => (
                      <li key={a.sku} className="flex justify-between gap-2 text-zinc-400">
                        <span className="truncate">
                          {a.product} · {a.color} {a.size}
                        </span>
                        <span className={a.stock <= 0 ? "text-rose-300" : "text-amber-300"}>
                          {a.stock <= 0 ? "Sold out" : `${a.stock} left`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-zinc-500">
                    All {m.catalogue.sellableVariants} sizes have more than 5 in stock.
                  </p>
                )}
                {m.catalogue.draftProducts > 0 && (
                  <p className="mt-2 text-xs text-zinc-500">{m.catalogue.draftProducts} draft product(s) not on the site.</p>
                )}
              </>
            ) : (
              <Unavailable what="Products" />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-right ${ok ? "text-emerald-300" : "text-amber-300"}`}>{value}</dd>
    </div>
  );
}

function Mini({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-md border border-white/[0.06] py-2">
      <div className={`text-lg font-semibold tabular-nums ${warn ? "text-amber-300" : "text-white"}`}>{value}</div>
      <div className="text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}
