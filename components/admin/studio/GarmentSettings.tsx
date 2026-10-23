"use client";

import { useEffect, useState } from "react";
import type { Garment, GarmentColour, GarmentSize } from "@/lib/studio/pricing";
import { parseQikinkSku, qikinkSku } from "@/lib/studio/pricing";
import { STUDIO_PRINT_TYPES } from "@/lib/studio/print-types";

const input = "rounded-md border border-white/10 bg-black/40 px-2 py-1 text-sm text-white focus:border-white/30 focus:outline-none";

export function GarmentSettings() {
  const [garments, setGarments] = useState<Garment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/studio/garments")
      .then((r) => r.json())
      .then((j) => (j.ok ? setGarments(j.garments) : setError(j.error)))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!garments) return <p className="text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-zinc-400">
        Qikink identifies each colour and size by a SKU like <code className="text-zinc-200">UPuHd-Bk-M</code>. Open Qikink → Products, copy any one SKU of
        the garment, paste it below, check the colour and size codes, then switch on <b>Confirmed</b>. Every product on that garment — new and existing —
        then sends orders to Qikink automatically.
      </p>
      {garments.map((g) => (
        <GarmentCard key={g.key} initial={g} onSaved={(saved) => setGarments((prev) => prev!.map((x) => (x.key === saved.key ? saved : x)))} />
      ))}
    </div>
  );
}

function GarmentCard({ initial, onSaved }: { initial: Garment; onSaved: (g: Garment) => void }) {
  const [g, setG] = useState<Garment>(initial);
  const [sample, setSample] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(g) !== JSON.stringify(initial);

  const applySample = () => {
    const parsed = parseQikinkSku(sample);
    if (!parsed) {
      setMsg({ ok: false, text: "That doesn't look like a Qikink SKU (e.g. UPuHd-Bk-M)." });
      return;
    }
    setG((prev) => {
      const colours = prev.colours.slice();
      const sizes = prev.sizes.slice();
      // The sample tells us the prefix for sure; colour/size codes are matched to the closest entry.
      const sizeIdx = sizes.findIndex((s) => s.size.toLowerCase() === parsed.sizeCode.toLowerCase() || s.code.toLowerCase() === parsed.sizeCode.toLowerCase());
      if (sizeIdx >= 0) sizes[sizeIdx] = { ...sizes[sizeIdx]!, code: parsed.sizeCode };
      const colourIdx = colours.findIndex((c) => c.code.toLowerCase() === parsed.colourCode.toLowerCase());
      if (colourIdx >= 0) colours[colourIdx] = { ...colours[colourIdx]!, code: parsed.colourCode };
      return { ...prev, skuPrefix: parsed.prefix, colours, sizes };
    });
    setMsg({ ok: true, text: `Prefix set to ${parsed.prefix}. Check the colour and size codes, then confirm.` });
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/studio/garments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: g.key,
          name: g.name,
          skuPrefix: g.skuPrefix,
          skuConfirmed: g.skuConfirmed,
          colours: g.colours,
          sizes: g.sizes,
          baseCostInr: Number(g.baseCostInr),
          weightGrams: Number(g.weightGrams),
          printTypes: g.printTypes,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      onSaved(j.garment);
      setG(j.garment);
      setMsg({ ok: true, text: j.garment.skuConfirmed ? "Saved. Orders for this garment now go to Qikink automatically." : "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save" });
    } finally {
      setSaving(false);
    }
  };

  const setColour = (i: number, patch: Partial<GarmentColour>) => setG((p) => ({ ...p, colours: p.colours.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const setSize = (i: number, patch: Partial<GarmentSize>) => setG((p) => ({ ...p, sizes: p.sizes.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const example = g.colours[0] && g.sizes[1] ? qikinkSku(g, g.colours[0], g.sizes[1]) : "";

  return (
    <section className="space-y-4 rounded-lg border border-white/[0.08] bg-zinc-950/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium text-white">{g.name}</h2>
          <p className="text-xs text-zinc-500">
            Qikink style {g.qikinkStyle ?? "—"} · SKU looks like <code className="text-zinc-300">{example}</code>
          </p>
        </div>
        <label className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${g.skuConfirmed ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}`}>
          <input type="checkbox" checked={g.skuConfirmed} onChange={(e) => setG({ ...g, skuConfirmed: e.target.checked })} className="accent-emerald-400" />
          {g.skuConfirmed ? "Confirmed in Qikink" : "Not confirmed"}
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-500">
          Paste a SKU from Qikink
          <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="UPuHd-Bk-M" className={`mt-1 block w-48 ${input}`} />
        </label>
        <button type="button" onClick={applySample} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:border-white/30">
          Use it
        </button>
        <label className="text-xs text-zinc-500">
          SKU prefix
          <input value={g.skuPrefix} onChange={(e) => setG({ ...g, skuPrefix: e.target.value.trim() })} className={`mt-1 block w-28 ${input}`} />
        </label>
        <label className="text-xs text-zinc-500">
          Qikink cost ₹
          <input type="number" min={0} value={g.baseCostInr} onChange={(e) => setG({ ...g, baseCostInr: Number(e.target.value) })} className={`mt-1 block w-24 ${input}`} />
        </label>
        <label className="text-xs text-zinc-500">
          Weight g
          <input type="number" min={1} value={g.weightGrams} onChange={(e) => setG({ ...g, weightGrams: Number(e.target.value) })} className={`mt-1 block w-24 ${input}`} />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-zinc-500">Colours (name · Qikink code · colour)</div>
          <div className="space-y-1.5">
            {g.colours.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input value={c.name} onChange={(e) => setColour(i, { name: e.target.value })} className={`w-32 ${input}`} aria-label="Colour name" />
                <input value={c.code} onChange={(e) => setColour(i, { code: e.target.value.trim() })} className={`w-16 ${input}`} aria-label="Qikink colour code" />
                <input type="color" value={c.hex} onChange={(e) => setColour(i, { hex: e.target.value })} className="h-8 w-10 rounded border border-white/10 bg-transparent" aria-label="Colour" />
                <button type="button" onClick={() => setG({ ...g, colours: g.colours.filter((_, j) => j !== i) })} className="px-1 text-zinc-500 hover:text-rose-300" aria-label="Remove colour">
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setG({ ...g, colours: [...g.colours, { name: "", code: "", hex: "#777777" }] })} className="text-xs text-zinc-400 hover:text-white">
              + Add colour
            </button>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-zinc-500">Sizes (size · Qikink code)</div>
          <div className="space-y-1.5">
            {g.sizes.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input value={s.size} onChange={(e) => setSize(i, { size: e.target.value })} className={`w-20 ${input}`} aria-label="Size" />
                <input value={s.code} onChange={(e) => setSize(i, { code: e.target.value.trim() })} className={`w-20 ${input}`} aria-label="Qikink size code" />
                <button type="button" onClick={() => setG({ ...g, sizes: g.sizes.filter((_, j) => j !== i) })} className="px-1 text-zinc-500 hover:text-rose-300" aria-label="Remove size">
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setG({ ...g, sizes: [...g.sizes, { size: "", code: "" }] })} className="text-xs text-zinc-400 hover:text-white">
              + Add size
            </button>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs text-zinc-500">Print types offered</div>
        <div className="flex flex-wrap gap-1.5">
          {STUDIO_PRINT_TYPES.map((t) => {
            const on = g.printTypes.includes(t.key);
            return (
              <button key={t.key} type="button" onClick={() => setG({ ...g, printTypes: on ? g.printTypes.filter((x) => x !== t.key) : [...g.printTypes, t.key] })} className={`rounded-md border px-2.5 py-1 text-xs ${on ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-zinc-500"}`}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
