"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlacementLocation, PrintMethod } from "@/lib/wearables/design-types";
import type { DesignAnalysis, DetectedDesign } from "@/lib/studio/ai";
import { estimateCostInr, STUDIO_FX_TO_INR, suggestedPriceInr, type Garment } from "@/lib/studio/pricing";
import { defaultWidthIn, PLACEMENT_LABEL, STUDIO_PRINT_TYPES, type StudioPrintType } from "@/lib/studio/print-types";
import type { GarmentShape } from "@/lib/studio/mockup-svg";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MockupPreview } from "./MockupPreview";
import { MIN_STITCH_MM, useStitchCheck } from "./useStitchCheck";

type Box = { x0: number; y0: number; x1: number; y1: number };
type Step = "upload" | "design" | "artwork" | "print" | "price" | "done";

type Source = {
  sourcePath: string;
  previewUrl: string;
  width: number;
  height: number;
  hasTransparency: boolean;
  aiAvailable: boolean;
  aiError?: string;
  analysis: DesignAnalysis | null;
};

type Artwork = {
  artworkPath: string;
  previewUrl: string;
  width: number;
  height: number;
  palette: string[];
  flat: boolean;
  sourceHadTransparency: boolean;
};

type Published = { slug: string; url: string; status: "active" | "draft"; qikinkReady: boolean; printFile: { widthIn: number; heightIn: number; widthPx: number; heightPx: number; dpi: number } };

const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "design", label: "Design" },
  { key: "artwork", label: "Artwork" },
  { key: "print", label: "Print" },
  { key: "price", label: "Price" },
];

const SHAPE: Record<string, GarmentShape> = { tee: "tee", oversized_tee: "oversized_tee", hoodie: "hoodie", sweatshirt: "sweatshirt" };

async function api<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined && method === "POST" ? "GET" : method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/** Detected hoodie/sweatshirt/oversized → that garment; any regular tee (or nothing detected) → the first garment in the list. */
function garmentKeyFor(analysis: DesignAnalysis | null, garments: Garment[]): string | undefined {
  const t = analysis?.garment.type;
  if ((t === "hoodie" || t === "sweatshirt" || t === "oversized_tee") && garments.some((g) => g.key === t)) return t;
  return garments[0]?.key;
}

function printTypeFor(design: DetectedDesign | undefined): PrintMethod {
  switch (design?.technique) {
    case "embroidery":
      return "embroidery";
    case "puff":
      return "puff";
    case "metallic_vinyl":
      return "vinyl_gold";
    case "glow":
      return "glow";
    default:
      return "dtg";
  }
}

function money(amount: number, currency: "INR" | "USD"): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
}

/** Phone photos can be huge; keep uploads under ~20 MB without visible loss. */
async function prepareFile(file: File): Promise<Blob> {
  if (file.size <= 20 * 1024 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 5000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read the image"))), "image/jpeg", 0.92));
}

export function StudioFlow() {
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [designIndex, setDesignIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);

  const [colours, setColours] = useState<"auto" | "full" | number>("auto");
  const [tolerance, setTolerance] = useState(35);
  const [artwork, setArtwork] = useState<Artwork | null>(null);

  const [garments, setGarments] = useState<Garment[]>([]);
  const [garmentKey, setGarmentKey] = useState("tee");
  const [printKey, setPrintKey] = useState<PrintMethod>("dtg");
  const [placement, setPlacement] = useState<PlacementLocation>("front");
  const [widthIn, setWidthIn] = useState(11);
  const [garmentColours, setGarmentColours] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [price, setPrice] = useState<string>("");
  const [useSourcePhoto, setUseSourcePhoto] = useState(true);
  const [published, setPublished] = useState<Published | null>(null);

  useEffect(() => {
    api<{ garments: Garment[] }>("/api/admin/studio/garments")
      .then((r) => setGarments(r.garments.filter((g) => g.isActive)))
      .catch((e) => setError(e.message));
  }, []);

  const garment = garments.find((g) => g.key === garmentKey) ?? garments[0];
  const printType: StudioPrintType = STUDIO_PRINT_TYPES.find((t) => t.key === printKey) ?? STUDIO_PRINT_TYPES[0]!;
  const allowedPrintTypes = STUDIO_PRINT_TYPES.filter((t) => garment?.printTypes.includes(t.key));
  const placements = Object.keys(printType.maxSize) as PlacementLocation[];
  const area = printType.maxSize[placement] ?? { w: 3.5, h: 3.5 };
  const aspect = artwork ? artwork.height / artwork.width : 1;
  const printW = Math.min(widthIn, area.w, area.h / aspect);
  const printH = printW * aspect;
  const isEmbroidery = printType.key === "embroidery";
  const fineShare = useStitchCheck(artwork?.previewUrl, printW, step === "print" && isEmbroidery);
  const tooManyThreads = Boolean(artwork && isEmbroidery && (!artwork.flat || artwork.palette.length > (printType.maxColours ?? 6)));
  const designs = source?.analysis?.designs ?? [];
  const selectedDesign = designs[designIndex];

  /* ── step 1: upload ── */
  const onFile = async (file: File) => {
    setError(null);
    if (!rightsConfirmed) {
      setError("Tick the box to confirm you can sell this design.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Use a JPG, PNG or WebP image.");
      return;
    }
    try {
      setBusy("Uploading…");
      const blob = await prepareFile(file);
      const contentType = blob.type || file.type;
      const { bucket, path, token } = await api<{ bucket: string; path: string; token: string }>("/api/admin/studio/upload-url", { contentType });
      const { error: upErr } = await createSupabaseBrowserClient().storage.from(bucket).uploadToSignedUrl(path, token, blob, { contentType });
      if (upErr) throw new Error(upErr.message);
      setBusy("Finding the design…");
      const result = await api<Source>("/api/admin/studio/analyze", { path });
      setSource(result);
      const first = result.analysis?.designs[0];
      setDesignIndex(0);
      setBox(first ? first.box : result.hasTransparency || result.analysis?.imageKind === "artwork_file" ? { x0: 0, y0: 0, x1: 1, y1: 1 } : null);
      setTitle(result.analysis?.suggestedTitle || "");
      setDescription(result.analysis?.suggestedDescription || "");
      setUseSourcePhoto(Boolean(result.analysis && result.analysis.imageKind !== "artwork_file"));
      setStep("design");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  /* ── step 2→3: extract ── */
  const extract = useCallback(
    async (opts?: { colours?: "auto" | "full" | number; tolerance?: number; stay?: boolean }) => {
      if (!source || !box) return;
      setError(null);
      setBusy("Cleaning up the artwork…");
      try {
        const result = await api<Artwork>("/api/admin/studio/extract", {
          sourcePath: source.sourcePath,
          box,
          colours: opts?.colours ?? colours,
          tolerance: opts?.tolerance ?? tolerance,
        });
        setArtwork(result);
        if (!opts?.stay) setStep("artwork");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't extract the design");
      } finally {
        setBusy(null);
      }
    },
    [source, box, colours, tolerance],
  );

  const useDesign = () => {
    const kind = source?.analysis?.imageKind;
    const style = selectedDesign?.style;
    const technique = selectedDesign?.technique;
    const startColours: "auto" | "full" | number =
      technique === "embroidery" ? Math.min(6, selectedDesign?.colourCount ?? 4) : style === "photographic" || kind === "artwork_file" ? "full" : "auto";
    setColours(startColours);
    void extract({ colours: startColours });
  };

  /* ── step 3→4: print defaults ── */
  const toPrint = () => {
    const key = garmentKeyFor(source?.analysis ?? null, garments);
    const g = garments.find((x) => x.key === key) ?? garments[0];
    if (!g) return;
    setGarmentKey(g.key);
    const wanted = printTypeFor(selectedDesign);
    const pt = g.printTypes.includes(wanted) ? wanted : g.printTypes[0] ?? "dtg";
    setPrintKey(pt);
    const type = STUDIO_PRINT_TYPES.find((t) => t.key === pt)!;
    const detected = selectedDesign?.placement as PlacementLocation | undefined;
    const pl = detected && type.maxSize[detected] ? detected : ((Object.keys(type.maxSize)[0] ?? "front") as PlacementLocation);
    setPlacement(pl);
    setWidthIn(defaultWidthIn(type, pl, artwork ? artwork.height / artwork.width : 1));
    const detectedColour = source?.analysis?.garment.colourName.toLowerCase();
    const match = g.colours.find((c) => c.name.toLowerCase() === detectedColour);
    setGarmentColours([match?.name ?? g.colours[0]!.name]);
    setSizes(g.sizes.map((s) => s.size));
    setStep("print");
  };

  const changeGarment = (key: string) => {
    const g = garments.find((x) => x.key === key);
    if (!g) return;
    setGarmentKey(key);
    if (!g.printTypes.includes(printKey)) setPrintKey(g.printTypes[0] ?? "dtg");
    setGarmentColours((prev) => {
      const kept = prev.filter((c) => g.colours.some((gc) => gc.name === c));
      return kept.length ? kept : [g.colours[0]!.name];
    });
    setSizes(g.sizes.map((s) => s.size));
  };

  const changePrintType = (key: PrintMethod) => {
    const type = STUDIO_PRINT_TYPES.find((t) => t.key === key)!;
    setPrintKey(key);
    const pl = type.maxSize[placement] ? placement : ((Object.keys(type.maxSize)[0] ?? "front") as PlacementLocation);
    setPlacement(pl);
    setWidthIn(defaultWidthIn(type, pl, aspect));
    if (type.garmentColours) setGarmentColours((prev) => prev.filter((c) => type.garmentColours!.includes(c.toLowerCase())));
  };

  /* ── pricing ── */
  const cost = useMemo(() => {
    if (!garment) return null;
    return estimateCostInr(garment, garmentColours[0] ?? "Black", [{ printType: printKey, widthIn: printW, heightIn: printH }]);
  }, [garment, garmentColours, printKey, printW, printH]);
  const costInCurrency = cost ? (currency === "INR" ? cost.total : Math.round((cost.total / STUDIO_FX_TO_INR) * 100) / 100) : 0;
  const quickPrices = cost
    ? [0.5, 0.6, 0.67].map((m) => {
        const inr = suggestedPriceInr(cost.total, m);
        return currency === "INR" ? inr : Math.max(5, Math.ceil(inr / STUDIO_FX_TO_INR) - 0.01);
      })
    : [];
  const priceNum = Number(price);
  const profit = priceNum > 0 ? priceNum - costInCurrency : 0;
  const margin = priceNum > 0 ? Math.round((profit / priceNum) * 100) : 0;

  const goPrice = () => {
    if (!price && quickPrices[1]) setPrice(String(quickPrices[1]));
    if (!title) setTitle(selectedDesign?.label ? `${selectedDesign.label} ${garment?.name ?? ""}`.trim() : "");
    setStep("price");
  };

  const publish = async (status: "active" | "draft") => {
    if (!source || !artwork || !garment) return;
    setError(null);
    setBusy(status === "active" ? "Publishing… making print file and mockups" : "Saving draft…");
    try {
      const result = await api<Published>("/api/admin/studio/publish", {
        sourcePath: source.sourcePath,
        artworkPath: artwork.artworkPath,
        flat: artwork.flat,
        useSourcePhoto: useSourcePhoto && !source.hasTransparency,
        title,
        description,
        garmentKey: garment.key,
        colours: garmentColours,
        sizes,
        printType: printKey,
        placement,
        widthIn: printW,
        price: priceNum,
        currency,
        status,
        rightsConfirmed,
        palette: artwork.palette,
      });
      setPublished(result);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publishing failed");
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setStep("upload");
    setSource(null);
    setArtwork(null);
    setBox(null);
    setPublished(null);
    setTitle("");
    setDescription("");
    setPrice("");
    setError(null);
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const colourHex = garment?.colours.find((c) => c.name === garmentColours[0])?.hex ?? "#151515";

  return (
    <div className="space-y-6">
      {step !== "done" && (
        <ol className="flex gap-1 overflow-x-auto text-xs">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 ${
                i === stepIndex ? "border-white/40 bg-white/10 text-white" : i < stepIndex ? "border-white/10 text-zinc-300" : "border-white/[0.06] text-zinc-600"
              }`}
            >
              <span className="tabular-nums">{i + 1}</span> {s.label}
            </li>
          ))}
        </ol>
      )}

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {busy && (
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-200">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" /> {busy}
        </div>
      )}

      {step === "upload" && (
        <UploadStep rightsConfirmed={rightsConfirmed} setRightsConfirmed={setRightsConfirmed} onFile={onFile} disabled={Boolean(busy)} />
      )}

      {step === "design" && source && (
        <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <BoxEditor imageUrl={source.previewUrl} width={source.width} height={source.height} designs={designs} selected={designIndex} box={box} onBox={setBox} onSelect={(i) => { setDesignIndex(i); setBox(designs[i]!.box); }} />
          <div className="space-y-4 text-sm">
            {source.analysis ? (
              designs.length > 0 ? (
                <div className="space-y-2">
                  <h2 className="font-medium text-white">Found {designs.length === 1 ? "this design" : `${designs.length} designs`}</h2>
                  {designs.map((d, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setDesignIndex(i); setBox(d.box); }}
                      className={`w-full rounded-md border px-3 py-2 text-left ${i === designIndex ? "border-white/40 bg-white/10" : "border-white/10 hover:border-white/25"}`}
                    >
                      <div className="text-zinc-100">{d.label}</div>
                      <div className="text-xs text-zinc-400">
                        {d.technique === "embroidery" ? "Embroidered" : d.technique === "print" ? "Printed" : d.technique.replace("_", " ")} · {PLACEMENT_LABEL[d.placement as PlacementLocation] ?? d.placement} · {d.colourCount} colour{d.colourCount === 1 ? "" : "s"}
                      </div>
                    </button>
                  ))}
                  <p className="text-xs text-zinc-500">
                    On a {source.analysis.garment.colourName.toLowerCase()} {source.analysis.garment.type.replace("_", " ")}. Not quite right? Drag a new box on the image.
                  </p>
                </div>
              ) : (
                <p className="text-zinc-300">No design was found automatically. Drag a box around it on the image.</p>
              )
            ) : (
              <p className="text-zinc-300">
                {source.aiAvailable ? `Automatic detection didn't work (${source.aiError ?? "no result"}).` : "Automatic detection is off (no Claude API key)."} Drag a box around the design on the image.
              </p>
            )}
            {source.analysis?.rights.mayContainThirdPartyIp && (
              <div className="rounded-md border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                This may include {source.analysis.rights.details || "someone else's brand or character"}. Qikink cancels orders with copyrighted designs and doesn&apos;t refund them — only continue if you own it or have permission.
              </div>
            )}
            <button type="button" onClick={() => setBox({ x0: 0, y0: 0, x1: 1, y1: 1 })} className="text-xs text-zinc-400 underline-offset-4 hover:text-white hover:underline">
              Use the whole image
            </button>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={reset} className="rounded-md border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:border-white/30">
                Start over
              </button>
              <button type="button" disabled={!box || Boolean(busy)} onClick={useDesign} className="flex-1 rounded-md bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">
                Use this design →
              </button>
            </div>
          </div>
        </section>
      )}

      {step === "artwork" && artwork && (
        <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="rounded-lg border border-white/10 bg-[conic-gradient(#3f3f46_25%,#27272a_0_50%,#3f3f46_0_75%,#27272a_0)] bg-[length:24px_24px] p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={artwork.previewUrl} alt="Extracted artwork" className="mx-auto max-h-[60vh] w-auto object-contain" />
          </div>
          <div className="space-y-5 text-sm">
            <div>
              <h2 className="font-medium text-white">Artwork</h2>
              <p className="mt-1 text-xs text-zinc-400">
                {artwork.width} × {artwork.height} px · {artwork.flat ? `${artwork.palette.length} flat colour${artwork.palette.length === 1 ? "" : "s"}` : "full colour"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {artwork.palette.map((c) => (
                  <span key={c} className="h-6 w-6 rounded border border-white/20" style={{ backgroundColor: c }} title={c} />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs text-zinc-500">Colours</div>
              <div className="flex flex-wrap gap-1.5">
                {(["auto", "full", 1, 2, 3, 4, 5, 6] as const).map((c) => (
                  <button
                    key={String(c)}
                    type="button"
                    onClick={() => { setColours(c); void extract({ colours: c }); }}
                    className={`rounded-md border px-2.5 py-1 text-xs ${colours === c ? "border-white/50 bg-white/10 text-white" : "border-white/10 text-zinc-400 hover:text-white"}`}
                  >
                    {c === "auto" ? "Auto" : c === "full" ? "Full colour" : c}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">Flat colours give clean edges — best for logos, text and embroidery.</p>
            </div>
            {!artwork.sourceHadTransparency && (
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-zinc-500">
                  <span>Remove background</span>
                  <span>{tolerance === 0 ? "Off — keep it" : tolerance}</span>
                </div>
                <input type="range" min={0} max={100} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} onPointerUp={() => void extract()} onKeyUp={() => void extract()} className="w-full accent-white" />
              </div>
            )}
            <QualityNote artwork={artwork} />
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setStep("design")} className="rounded-md border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:border-white/30">
                ← Back
              </button>
              <button type="button" disabled={Boolean(busy) || garments.length === 0} onClick={toPrint} className="flex-1 rounded-md bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">
                Looks right →
              </button>
            </div>
          </div>
        </section>
      )}

      {step === "print" && artwork && garment && (
        <section className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="mx-auto w-full max-w-md">
            <MockupPreview
              shape={SHAPE[garment.key] ?? "tee"}
              colourHex={colourHex}
              placement={placement}
              artworkUrl={artwork.previewUrl}
              widthIn={printW}
              heightIn={printH}
              inkHex={printType.colourMode === "single" ? printType.inkHex : undefined}
            />
          </div>
          <div className="space-y-5 text-sm">
            <Field label="Garment">
              <div className="grid grid-cols-2 gap-1.5">
                {garments.map((g) => (
                  <button key={g.key} type="button" onClick={() => changeGarment(g.key)} className={`rounded-md border px-3 py-2 text-left ${g.key === garment.key ? "border-white/50 bg-white/10" : "border-white/10 hover:border-white/25"}`}>
                    <div className="text-zinc-100">{g.name}</div>
                    <div className="text-xs text-zinc-500">Qikink from ₹{g.baseCostInr}</div>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Print type (sent to Qikink)">
              <div className="space-y-1.5">
                {allowedPrintTypes.map((t) => (
                  <label key={t.key} className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 ${t.key === printKey ? "border-white/50 bg-white/10" : "border-white/10 hover:border-white/25"}`}>
                    <input type="radio" name="printType" className="mt-1 accent-white" checked={t.key === printKey} onChange={() => changePrintType(t.key)} />
                    <span>
                      <span className="text-zinc-100">{t.label}</span>
                      <span className="block text-xs text-zinc-500">{t.blurb}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Placement">
              <div className="flex flex-wrap gap-1.5">
                {placements.map((p) => (
                  <button key={p} type="button" onClick={() => { setPlacement(p); setWidthIn(defaultWidthIn(printType, p, aspect)); }} className={`rounded-md border px-3 py-1.5 text-xs ${p === placement ? "border-white/50 bg-white/10 text-white" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                    {PLACEMENT_LABEL[p]}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={`Print size — ${printW.toFixed(1)} × ${printH.toFixed(1)} in (max ${area.w} × ${area.h})`}>
              <input type="range" min={1} max={area.w} step={0.1} value={Math.min(widthIn, area.w)} onChange={(e) => setWidthIn(Number(e.target.value))} className="w-full accent-white" />
            </Field>
            <Field label="Colours">
              <div className="flex flex-wrap gap-1.5">
                {garment.colours.map((c) => {
                  const disabled = Boolean(printType.garmentColours && !printType.garmentColours.includes(c.name.toLowerCase()));
                  const on = garmentColours.includes(c.name);
                  return (
                    <button
                      key={c.name}
                      type="button"
                      disabled={disabled}
                      onClick={() => setGarmentColours((prev) => (on ? prev.filter((x) => x !== c.name) : [...prev, c.name]))}
                      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-30 ${on ? "border-white/50 bg-white/10 text-white" : "border-white/10 text-zinc-400"}`}
                    >
                      <span className="h-3.5 w-3.5 rounded-full border border-white/30" style={{ backgroundColor: c.hex }} /> {c.name}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Sizes">
              <div className="flex flex-wrap gap-1.5">
                {garment.sizes.map((s) => {
                  const on = sizes.includes(s.size);
                  return (
                    <button key={s.size} type="button" onClick={() => setSizes((prev) => (on ? prev.filter((x) => x !== s.size) : [...prev, s.size]))} className={`min-w-10 rounded-md border px-2.5 py-1.5 text-xs ${on ? "border-white/50 bg-white/10 text-white" : "border-white/10 text-zinc-400"}`}>
                      {s.size}
                    </button>
                  );
                })}
              </div>
            </Field>
            {isEmbroidery && (
              <div className="space-y-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs">
                <div className="text-zinc-400">Embroidery check</div>
                {tooManyThreads ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-amber-300">
                    <span>
                      Embroidery uses up to {printType.maxColours ?? 6} thread colours — this artwork {artwork?.flat ? `has ${artwork.palette.length}` : "is full colour"}.
                    </span>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        const n = Math.min(printType.maxColours ?? 6, Math.max(2, artwork?.palette.length ?? 6));
                        setColours(n);
                        void extract({ colours: n, stay: true });
                      }}
                      className="rounded border border-amber-400/40 px-2 py-1 text-amber-200 hover:bg-amber-400/10"
                    >
                      Flatten to {Math.min(printType.maxColours ?? 6, Math.max(2, artwork?.palette.length ?? 6))} threads
                    </button>
                  </div>
                ) : (
                  <div className="text-emerald-300">{artwork?.palette.length} thread colour{artwork?.palette.length === 1 ? "" : "s"} — within Qikink&apos;s limit.</div>
                )}
                {fineShare === null ? (
                  <div className="text-zinc-500">Checking stitch detail…</div>
                ) : fineShare > 0.08 ? (
                  <div className="text-amber-300">
                    About {Math.round(fineShare * 100)}% of the design is finer than Qikink&apos;s {MIN_STITCH_MM} mm minimum at {printW.toFixed(1)} in — those parts won&apos;t stitch cleanly. Simplify it, or use DTG print for a detailed design.
                  </div>
                ) : (
                  <div className="text-emerald-300">Lines are thick enough to stitch at this size ({MIN_STITCH_MM} mm minimum).</div>
                )}
              </div>
            )}
            <p className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-400">
              Qikink file: PNG · {Math.round(printW * 300)} × {Math.round(printH * 300)} px · 300 DPI · transparent · print type {printType.qikinkId} · placement {placement === "left_chest" ? "lp" : placement === "right_chest" ? "rp" : placement === "back" ? "bk" : placement === "left_sleeve" ? "ls" : placement === "right_sleeve" ? "rs" : "fr"}
              {printType.turnaroundNote ? ` · ${printType.turnaroundNote}` : ""}
              {!garment.skuConfirmed && (
                <span className="mt-1 block text-amber-300">
                  {garment.name}&apos;s Qikink SKU codes aren&apos;t confirmed yet — orders will wait until you <Link href="/admin/studio/garments" className="underline">confirm them once</Link>.
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep("artwork")} className="rounded-md border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:border-white/30">
                ← Back
              </button>
              <button type="button" disabled={garmentColours.length === 0 || sizes.length === 0 || tooManyThreads} onClick={goPrice} className="flex-1 rounded-md bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">
                Set the price →
              </button>
            </div>
          </div>
        </section>
      )}

      {step === "price" && artwork && garment && cost && (
        <section className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <Field label="Product name">
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="e.g. Rose Crest Hoodie" className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-white focus:border-white/30 focus:outline-none" />
            </Field>
            <Field label="Description">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={400} className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none" />
            </Field>
            {source && !source.hasTransparency && source.analysis?.imageKind !== "artwork_file" && (
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <input type="checkbox" checked={useSourcePhoto} onChange={(e) => setUseSourcePhoto(e.target.checked)} className="mt-1 accent-white" />
                Use the uploaded photo as the main product image (mockups are added for each colour)
              </label>
            )}
            <div className="mx-auto w-full max-w-xs">
              <MockupPreview shape={SHAPE[garment.key] ?? "tee"} colourHex={colourHex} placement={placement} artworkUrl={artwork.previewUrl} widthIn={printW} heightIn={printH} inkHex={printType.colourMode === "single" ? printType.inkHex : undefined} />
            </div>
          </div>
          <div className="space-y-5 text-sm">
            <Field label="Currency">
              <div className="flex gap-1.5">
                {(["INR", "USD"] as const).map((c) => (
                  <button key={c} type="button" onClick={() => { setCurrency(c); setPrice(""); }} className={`rounded-md border px-3 py-1.5 text-xs ${currency === c ? "border-white/50 bg-white/10 text-white" : "border-white/10 text-zinc-400"}`}>
                    {c === "INR" ? "₹ Rupees" : "$ Dollars"}
                  </button>
                ))}
              </div>
            </Field>
            <div className="rounded-md border border-white/10 bg-black/30 p-3 text-xs">
              <div className="mb-1.5 text-zinc-400">Qikink cost per piece (estimate)</div>
              <dl className="space-y-1 text-zinc-300">
                <Row k={garment.name} v={`₹${cost.garment}`} />
                <Row k={printType.label} v={`₹${cost.print}`} />
                <Row k="GST 5%" v={`₹${cost.gst}`} />
                <Row k="Shipping (air)" v={`₹${cost.shipping}`} />
                <div className="border-t border-white/10 pt-1">
                  <Row k="Total" v={currency === "INR" ? `₹${cost.total}` : `₹${cost.total} ≈ ${money(costInCurrency, "USD")}`} strong />
                </div>
              </dl>
            </div>
            <Field label="Price on your store">
              <div className="flex items-center gap-2">
                <span className="text-lg text-zinc-400">{currency === "INR" ? "₹" : "$"}</span>
                <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-2xl font-semibold text-white tabular-nums focus:border-white/30 focus:outline-none" />
              </div>
              <div className="mt-2 flex gap-1.5">
                {quickPrices.map((q, i) => (
                  <button key={i} type="button" onClick={() => setPrice(String(q))} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:border-white/30">
                    {money(q, currency)} <span className="text-zinc-500">· {["50%", "60%", "67%"][i]} margin</span>
                  </button>
                ))}
              </div>
              {priceNum > 0 && (
                <p className={`mt-2 text-xs ${profit > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {profit > 0 ? `You keep about ${money(profit, currency)} per sale (${margin}%) before payment fees.` : "This price is below Qikink's cost."}
                </p>
              )}
            </Field>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep("print")} className="rounded-md border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:border-white/30">
                ← Back
              </button>
              <button type="button" disabled={Boolean(busy) || !(priceNum > 0) || title.trim().length < 3} onClick={() => void publish("draft")} className="rounded-md border border-white/20 px-4 py-2 text-sm text-zinc-200 disabled:opacity-40">
                Save draft
              </button>
              <button type="button" disabled={Boolean(busy) || !(priceNum > 0) || title.trim().length < 3} onClick={() => void publish("active")} className="flex-1 rounded-md bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">
                Publish
              </button>
            </div>
          </div>
        </section>
      )}

      {step === "done" && published && (
        <section className="mx-auto max-w-lg space-y-4 rounded-lg border border-white/10 bg-zinc-950/60 p-6 text-center">
          <h2 className="text-lg font-semibold text-white">{published.status === "active" ? "It's live on your store" : "Saved as a draft"}</h2>
          <p className="text-sm text-zinc-400">
            Print file made: {published.printFile.widthIn} × {published.printFile.heightIn} in, {published.printFile.widthPx} × {published.printFile.heightPx} px at {published.printFile.dpi} DPI.
          </p>
          {!published.qikinkReady && (
            <p className="rounded-md border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              People can buy it now, but orders won&apos;t go to Qikink until {garment?.name ?? "this garment"}&apos;s SKU codes are confirmed.{" "}
              <Link href="/admin/studio/garments" className="underline">Confirm once</Link> and every product on it starts sending.
            </p>
          )}
          <div className="flex justify-center gap-2">
            {published.status === "active" && (
              <a href={published.url} target="_blank" rel="noreferrer" className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black">
                View on store
              </a>
            )}
            <button type="button" onClick={reset} className="rounded-md border border-white/20 px-4 py-2 text-sm text-zinc-200">
              Add another design
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs text-zinc-500">{label}</div>
      {children}
    </div>
  );
}

function Row({ k, v, strong = false }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-medium text-white" : ""}`}>
      <dt>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function QualityNote({ artwork }: { artwork: Artwork }) {
  const dpiAt10 = Math.round(artwork.width / 10);
  if (artwork.flat) {
    return <p className="text-xs text-zinc-500">Edges are rebuilt when it&apos;s enlarged, so flat-colour artwork prints sharp at any size.</p>;
  }
  if (dpiAt10 < 150) {
    return (
      <p className="text-xs text-amber-300">
        Only {dpiAt10} DPI at 10 in wide — a big full-colour print may look soft. Use flat colours, print smaller, or upload the original artwork file.
      </p>
    );
  }
  return <p className="text-xs text-zinc-500">{dpiAt10} DPI at 10 in wide — good for printing.</p>;
}

function UploadStep({
  rightsConfirmed,
  setRightsConfirmed,
  onFile,
  disabled,
}: {
  rightsConfirmed: boolean;
  setRightsConfirmed: (v: boolean) => void;
  onFile: (f: File) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <section className="mx-auto max-w-xl space-y-4">
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-16 text-center transition ${drag ? "border-white/60 bg-white/5" : "border-white/15 hover:border-white/30"} disabled:opacity-50`}
      >
        <span className="text-base text-white">Drop a photo or artwork here</span>
        <span className="text-xs text-zinc-500">A model wearing it, a flat-lay, a mockup, or the artwork file · JPG, PNG or WebP</span>
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <label className="flex items-start gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={rightsConfirmed} onChange={(e) => setRightsConfirmed(e.target.checked)} className="mt-1 accent-white" />
        <span>
          This is our own design, or we have the creator&apos;s permission to sell it.
          <span className="block text-xs text-zinc-500">Qikink cancels orders with copyrighted designs and doesn&apos;t refund them.</span>
        </span>
      </label>
    </section>
  );
}

function BoxEditor({
  imageUrl,
  width,
  height,
  designs,
  selected,
  box,
  onBox,
  onSelect,
}: {
  imageUrl: string;
  width: number;
  height: number;
  designs: DetectedDesign[];
  selected: number;
  box: Box | null;
  onBox: (b: Box) => void;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);

  const point = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const toBox = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });
  const shown = draft ?? box;

  return (
    <div>
      <div
        ref={ref}
        className="relative mx-auto w-full touch-none select-none overflow-hidden rounded-lg border border-white/10"
        style={{ aspectRatio: `${width} / ${height}`, maxHeight: "70vh", maxWidth: `calc(70vh * ${width / height})` }}
        onPointerDown={(e) => { start.current = point(e); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (start.current) setDraft(toBox(start.current, point(e))); }}
        onPointerUp={(e) => {
          if (start.current) {
            const b = toBox(start.current, point(e));
            if (b.x1 - b.x0 > 0.02 && b.y1 - b.y0 > 0.02) onBox(b);
          }
          start.current = null;
          setDraft(null);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Uploaded" className="pointer-events-none h-full w-full object-contain" draggable={false} />
        {designs.map((d, i) =>
          i === selected && !draft ? null : (
            <button
              key={i}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSelect(i)}
              className="absolute border border-dashed border-white/50 hover:border-white"
              style={{ left: `${d.box.x0 * 100}%`, top: `${d.box.y0 * 100}%`, width: `${(d.box.x1 - d.box.x0) * 100}%`, height: `${(d.box.y1 - d.box.y0) * 100}%` }}
              aria-label={`Select ${d.label}`}
            />
          ),
        )}
        {shown && (
          <div
            className="pointer-events-none absolute border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{ left: `${shown.x0 * 100}%`, top: `${shown.y0 * 100}%`, width: `${(shown.x1 - shown.x0) * 100}%`, height: `${(shown.y1 - shown.y0) * 100}%` }}
          />
        )}
      </div>
      <p className="mt-2 text-center text-xs text-zinc-500">Drag on the image to draw a box around the design.</p>
    </div>
  );
}
