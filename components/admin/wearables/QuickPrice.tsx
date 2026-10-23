"use client";

import { useState } from "react";

/** Inline price editor: one price for every colour and size of the product. */
export function QuickPrice({
  productId,
  price,
  currency,
  onSaved,
}: {
  productId: string;
  price: number;
  currency: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(String(price));
  const [cur, setCur] = useState<"INR" | "USD">(currency === "USD" ? "USD" : "INR");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const dirty = Number(value) !== price || cur !== (currency === "USD" ? "USD" : "INR");

  const save = async () => {
    setState("saving");
    try {
      const res = await fetch("/api/admin/studio/price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, price: Number(value), currency: cur }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      setState("saved");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
      setState("error");
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={cur}
        onChange={(e) => setCur(e.target.value as "INR" | "USD")}
        className="rounded border border-white/10 bg-black/40 px-1 py-1 text-xs text-white"
        aria-label="Currency"
      >
        <option value="INR">₹</option>
        <option value="USD">$</option>
      </select>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          setValue(e.target.value.replace(/[^0-9.]/g, ""));
          setState("idle");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty && Number(value) > 0) void save();
        }}
        className="w-20 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-white tabular-nums"
        aria-label="Price"
      />
      {dirty && Number(value) > 0 && (
        <button type="button" onClick={() => void save()} disabled={state === "saving"} className="rounded bg-white px-2 py-1 text-[11px] font-medium text-black">
          {state === "saving" ? "…" : "Save"}
        </button>
      )}
      {state === "saved" && !dirty && <span className="text-[11px] text-emerald-300">Saved</span>}
      {state === "error" && <span className="text-[11px] text-rose-300" title={error}>Failed</span>}
    </div>
  );
}
