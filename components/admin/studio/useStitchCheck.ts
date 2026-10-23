"use client";

import { useEffect, useState } from "react";

/** Qikink's embroidery minimum line thickness. */
export const MIN_STITCH_MM = 0.8;
const PX_PER_IN = 127; // 0.2 mm per pixel
const RADIUS = Math.round(MIN_STITCH_MM / 2 / (25.4 / PX_PER_IN)); // 2 px

function minMax(src: Uint8Array, w: number, h: number, r: number, op: "min" | "max"): Uint8Array {
  const pick = op === "min" ? Math.min : Math.max;
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x]!;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        v = pick(v, xx < 0 || xx >= w ? 0 : src[y * w + xx]!);
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]!;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        v = pick(v, yy < 0 || yy >= h ? 0 : tmp[yy * w + x]!);
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * Share of the artwork (0–1) made of strokes thinner than Qikink's 0.8 mm embroidery minimum
 * at the chosen print width — those parts can't be stitched. Uses a morphological opening:
 * thin features disappear, thick shapes come back unchanged.
 */
export function useStitchCheck(artworkUrl: string | undefined, widthIn: number, enabled: boolean): number | null {
  const key = `${artworkUrl ?? ""}|${widthIn.toFixed(2)}`;
  const [result, setResult] = useState<{ key: string; share: number | null } | null>(null);
  useEffect(() => {
    if (!enabled || !artworkUrl || !(widthIn > 0)) return;
    let cancelled = false;
    const setShare = (share: number | null) => {
      if (!cancelled) setResult({ key, share });
    };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const w = Math.max(8, Math.round(widthIn * PX_PER_IN));
      const h = Math.max(8, Math.round((img.naturalHeight / img.naturalWidth) * w));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, w, h).data;
      } catch {
        setShare(null);
        return;
      }
      const mask = new Uint8Array(w * h);
      let ink = 0;
      for (let i = 0; i < w * h; i++) {
        if (data[i * 4 + 3]! >= 128) {
          mask[i] = 1;
          ink++;
        }
      }
      if (ink === 0) {
        setShare(null);
        return;
      }
      const opened = minMax(minMax(mask, w, h, RADIUS, "min"), w, h, RADIUS, "max");
      let kept = 0;
      for (let i = 0; i < w * h; i++) if (mask[i] && opened[i]) kept++;
      setShare(1 - kept / ink);
    };
    img.onerror = () => setShare(null);
    img.src = artworkUrl;
    return () => {
      cancelled = true;
    };
  }, [artworkUrl, widthIn, enabled, key]);
  return enabled && result?.key === key ? result.share : null;
}
