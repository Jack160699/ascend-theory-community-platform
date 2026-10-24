/**
 * Studio image pipeline (sharp):
 *  extractArtwork  — crop the design out of a photo, drop the fabric, optionally flatten to N colours
 *  renderPrintFile — scale to Qikink's print size at 300 DPI, crisp edges for flat artwork
 *  renderMockup    — composite the artwork onto a clean garment illustration for the store
 */

import sharp from "sharp";
import type { PlacementLocation } from "@/lib/wearables/design-types";
import type { ColourMode } from "./print-types";
import { MOCKUP_PPI, garmentSvg, mockupAnchor, type GarmentShape } from "./mockup-svg";

export type { GarmentShape } from "./mockup-svg";

export type NormBox = { x0: number; y0: number; x1: number; y1: number };

export type ExtractOptions = {
  /** "full" keeps every colour; a number flattens to that many inks/threads; "auto" estimates. */
  colours: "auto" | "full" | number;
  /** 0–100: how aggressively fabric-coloured pixels are removed. */
  tolerance: number;
};

export type ExtractResult = {
  png: Buffer;
  width: number;
  height: number;
  palette: string[];
  flat: boolean;
  backgroundHex: string;
  sourceHadTransparency: boolean;
};

export const PRINT_DPI = 300;
const QIKINK_MAX_FILE_BYTES = 24 * 1024 * 1024;

type Raw = { data: Buffer; width: number; height: number };

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  const n = m ? parseInt(m[1]!, 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Weighted RGB distance (closer to perceived difference than plain Euclidean). */
function colourDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 3;
}

/** Small deterministic PRNG so the same photo always gives the same palette. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

type Kmeans = { centroids: [number, number, number][]; inertia: number; counts: number[] };

export function kmeans(samples: Float32Array, k: number, iterations = 14): Kmeans {
  const n = samples.length / 3;
  const rand = rng(n * 31 + k);
  const centroids: [number, number, number][] = [];
  const first = Math.floor(rand() * n) * 3;
  centroids.push([samples[first]!, samples[first + 1]!, samples[first + 2]!]);
  const dist = new Float32Array(n).fill(Infinity);
  while (centroids.length < Math.min(k, n)) {
    const c = centroids[centroids.length - 1]!;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d =
        (samples[i * 3]! - c[0]) ** 2 + (samples[i * 3 + 1]! - c[1]) ** 2 + (samples[i * 3 + 2]! - c[2]) ** 2;
      if (d < dist[i]!) dist[i] = d;
      total += dist[i]!;
    }
    let pick = rand() * total;
    let idx = 0;
    for (; idx < n - 1; idx++) {
      pick -= dist[idx]!;
      if (pick <= 0) break;
    }
    centroids.push([samples[idx * 3]!, samples[idx * 3 + 1]!, samples[idx * 3 + 2]!]);
  }
  const assign = new Uint8Array(n);
  let inertia = 0;
  let counts: number[] = centroids.map(() => 0);
  for (let it = 0; it < iterations; it++) {
    const sums = centroids.map(() => [0, 0, 0, 0]);
    inertia = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const cc = centroids[c]!;
        const d = (samples[i * 3]! - cc[0]) ** 2 + (samples[i * 3 + 1]! - cc[1]) ** 2 + (samples[i * 3 + 2]! - cc[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
      inertia += bestD;
      const s = sums[best]!;
      s[0]! += samples[i * 3]!;
      s[1]! += samples[i * 3 + 1]!;
      s[2]! += samples[i * 3 + 2]!;
      s[3]! += 1;
    }
    sums.forEach((s, c) => {
      if (s[3]! > 0) centroids[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
    });
    counts = sums.map((s) => s[3]!);
  }
  return { centroids, inertia, counts };
}

/** True when colour c is just ink a faded into the fabric (an anti-aliased edge), not a real ink. */
export function isFabricBlend(c: [number, number, number], inks: [number, number, number][], fabric: [number, number, number]): boolean {
  for (const a of inks) {
    for (let t = 0.15; t <= 0.86; t += 0.05) {
      const mix: [number, number, number] = [a[0] * t + fabric[0] * (1 - t), a[1] * t + fabric[1] * (1 - t), a[2] * t + fabric[2] * (1 - t)];
      if (colourDistance(c[0], c[1], c[2], mix[0], mix[1], mix[2]) < 20) return true;
    }
  }
  return false;
}

/** sRGB → CIELAB (D65). */
export function toLab(c: [number, number, number]): [number, number, number] {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(c[0]);
  const g = lin(c[1]);
  const b = lin(c[2]);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * How different two thread colours look. Lightness counts half: in a photo the same thread
 * goes lighter and darker with stitch texture and folds, but its hue stays put — so sage
 * green and tan stay apart even when both are dull, while light and shadowed tan merge.
 */
export function threadDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt(((a[0] - b[0]) / 2) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}
const THREAD_MERGE = 12;

/**
 * Automatic palette for photos of real prints/embroidery: start from 10 candidate colours,
 * merge near-identical shades (thread texture, lighting), then drop specks and colours that
 * are only an ink fading into the fabric. Distinct hues (green vs tan) always survive.
 */
export function autoPalette(
  samples: Float32Array,
  fabric: [number, number, number],
  checkBlends: boolean,
): { inks: [number, number, number][]; erase: [number, number, number][] } {
  const { centroids, counts } = kmeans(samples, 14, 18);
  let clusters = centroids.map((c, i) => ({ c, n: counts[i] ?? 0 })).filter((x) => x.n > 0);
  for (;;) {
    let bi = -1;
    let bj = -1;
    let bd = Infinity;
    const labs = clusters.map((x) => toLab(x.c));
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = threadDistance(labs[i]!, labs[j]!);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || bd >= THREAD_MERGE) break;
    const A = clusters[bi]!;
    const B = clusters[bj]!;
    const total = A.n + B.n;
    A.c = [(A.c[0] * A.n + B.c[0] * B.n) / total, (A.c[1] * A.n + B.c[1] * B.n) / total, (A.c[2] * A.n + B.c[2] * B.n) / total];
    A.n = total;
    clusters.splice(bj, 1);
  }
  const total = clusters.reduce((s, x) => s + x.n, 0) || 1;
  clusters = clusters.filter((x) => x.n / total >= 0.01);
  const erase: [number, number, number][] = [];
  if (checkBlends && clusters.length > 1) {
    const fl = toLab(fabric);
    const isErase = (x: { c: [number, number, number]; n: number }, others: [number, number, number][]) => {
      const l = toLab(x.c);
      // Fabric in shadow (folds, stitch texture): same hue as the fabric, a bit darker/lighter.
      if (Math.hypot(l[1] - fl[1], l[2] - fl[2]) < 6 && Math.abs(l[0] - fl[0]) < 45) return true;
      // Anti-aliased edge: sits on the line between the fabric and another ink. Hue counts extra,
      // so a dull olive green isn't mistaken for dark brown fading into cream. Small clusters get a
      // looser test (they're usually edges); big ones must sit right on the line.
      const limit = x.n / total < 0.12 ? 7 : 4;
      for (const o of others) {
        for (let t = 0.1; t <= 0.9; t += 0.05) {
          const m = toLab([o[0] * t + fabric[0] * (1 - t), o[1] * t + fabric[1] * (1 - t), o[2] * t + fabric[2] * (1 - t)]);
          if (Math.hypot((l[0] - m[0]) * 0.5, (l[1] - m[1]) * 1.5, (l[2] - m[2]) * 1.5) < limit) return true;
        }
      }
      return false;
    };
    const flags = clusters.map((x, i) => isErase(x, clusters.filter((_, j) => j !== i).map((y) => y.c)));
    if (flags.some((f) => !f)) {
      clusters.forEach((x, i) => flags[i] && erase.push(x.c));
      clusters = clusters.filter((_, i) => !flags[i]);
    }
  }
  return {
    inks: clusters
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .map((x) => x.c),
    erase,
  };
}

/** Picks the smallest colour count that explains the artwork well (1–8). */
export function estimateColourCount(samples: Float32Array): number {
  if (samples.length < 30) return 1;
  const inertias: number[] = [];
  for (let k = 1; k <= 8; k++) inertias.push(kmeans(samples, k, 8).inertia);
  for (let k = 1; k < 8; k++) {
    const now = inertias[k - 1]!;
    const next = inertias[k]!;
    if (now <= inertias[0]! * 0.04) return k;
    if (now > 0 && (now - next) / now < 0.3 && now <= inertias[0]! * 0.2) return k;
  }
  return 8;
}

async function toRaw(input: sharp.Sharp): Promise<Raw> {
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Cleans an alpha mask in place: drops specks of minArea pixels or fewer and, when asked,
 * anything touching the crop edge (the crop is padded, so a real design never touches it —
 * edge-touching shapes are the photo's background or the model's arm).
 */
function cleanMask(alpha: Uint8Array, width: number, height: number, minArea: number, dropEdgeTouching: boolean): void {
  const seen = new Uint8Array(alpha.length);
  const stack = new Int32Array(alpha.length);
  const members: number[] = [];
  const keep = new Uint8Array(alpha.length);
  let kept = 0;
  for (let start = 0; start < alpha.length; start++) {
    if (alpha[start]! < 128 || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    members.length = 0;
    let touchesEdge = false;
    while (top > 0) {
      const p = stack[--top]!;
      members.push(p);
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      if (p >= width && !seen[p - width] && alpha[p - width]! >= 128) { seen[p - width] = 1; stack[top++] = p - width; }
      if (p < alpha.length - width && !seen[p + width] && alpha[p + width]! >= 128) { seen[p + width] = 1; stack[top++] = p + width; }
      if (x > 0 && !seen[p - 1] && alpha[p - 1]! >= 128) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (x < width - 1 && !seen[p + 1] && alpha[p + 1]! >= 128) { seen[p + 1] = 1; stack[top++] = p + 1; }
    }
    if (members.length > minArea && !(dropEdgeTouching && touchesEdge)) {
      for (const p of members) keep[p] = 1;
      kept += members.length;
    }
  }
  if (kept === 0) return; // never wipe the whole design — leave the mask as it was
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i]! >= 128 && !keep[i]) alpha[i] = 0;
    else if (alpha[i]! < 128 && alpha[i]! > 0) {
      // soft edge pixels survive only next to kept shapes
      const x = i % width;
      const near = (i >= width && keep[i - width]) || (i < alpha.length - width && keep[i + width]) || (x > 0 && keep[i - 1]) || (x < width - 1 && keep[i + 1]);
      if (!near) alpha[i] = 0;
    }
  }
}

/** 3×3 majority filter on a label map — cleans single-pixel noise after flattening. */
function majorityFilter(labels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(labels.length);
  const counts = new Uint16Array(16);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      counts.fill(0);
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          counts[labels[yy * width + xx]!]!++;
        }
      }
      let best = labels[y * width + x]!;
      for (let l = 0; l < 16; l++) if (counts[l]! > counts[best]!) best = l;
      out[y * width + x] = counts[best]! >= 5 ? best : labels[y * width + x]!;
    }
  }
  return out;
}

export async function extractArtwork(source: Buffer, box: NormBox, opts: ExtractOptions): Promise<ExtractResult> {
  const upright = await sharp(source, { failOn: "none" }).rotate().toBuffer();
  const base = sharp(upright);
  const meta = await sharp(upright).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("Couldn't read the image");

  const bw = (box.x1 - box.x0) * W;
  const bh = (box.y1 - box.y0) * H;
  const pad = Math.max(4, Math.round(Math.max(bw, bh) * 0.03));
  const left = Math.max(0, Math.floor(box.x0 * W - pad));
  const top = Math.max(0, Math.floor(box.y0 * H - pad));
  const width = Math.min(W - left, Math.ceil(bw + pad * 2));
  const height = Math.min(H - top, Math.ceil(bh + pad * 2));
  if (width < 8 || height < 8) throw new Error("The selected area is too small");

  // Work at up to 2400px on the long edge — enough detail, bounded memory.
  const scale = Math.min(1, 2400 / Math.max(width, height));
  const raw = await toRaw(
    base.extract({ left, top, width, height }).resize({ width: Math.round(width * scale), height: Math.round(height * scale) }),
  );
  const { data, width: w, height: h } = raw;
  const n = w * h;
  const alpha = new Uint8Array(n);

  let transparentPixels = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3]! < 250) transparentPixels++;
  const sourceHadTransparency = transparentPixels > n * 0.02;

  // Fabric colour = median of the border ring.
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      if (data[i + 3]! < 128) continue;
      rs.push(data[i]!);
      gs.push(data[i + 1]!);
      bs.push(data[i + 2]!);
    }
  }
  const bg: [number, number, number] = [median(rs), median(gs), median(bs)];
  const spread = median(rs.map((r, i) => colourDistance(r, gs[i]!, bs[i]!, bg[0], bg[1], bg[2])));

  const removeBackground = opts.tolerance > 0;
  if (sourceHadTransparency) {
    for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3]!;
  } else if (!removeBackground) {
    alpha.fill(255);
  } else {
    const t0 = Math.max(10 + opts.tolerance * 0.8, spread * 2.5);
    const t1 = t0 * 1.6;
    for (let i = 0; i < n; i++) {
      const d = colourDistance(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, bg[0], bg[1], bg[2]);
      alpha[i] = d <= t0 ? 0 : d >= t1 ? 255 : Math.round(((d - t0) / (t1 - t0)) * 255);
    }
  }
  if (removeBackground || sourceHadTransparency) {
    cleanMask(alpha, w, h, Math.max(6, Math.round(n * 0.00015)), removeBackground && !sourceHadTransparency);
  }

  // Collect opaque samples for the palette.
  const sampleStep = Math.max(1, Math.floor(n / 30000));
  const sampleList: number[] = [];
  for (let i = 0; i < n; i += sampleStep) {
    if (alpha[i]! >= 230) sampleList.push(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!);
  }
  if (sampleList.length < 30) throw new Error("No design found in that area — draw the box tighter or lower the background setting");
  const samples = Float32Array.from(sampleList);

  const colours = opts.colours;
  const auto = colours === "auto" ? autoPalette(samples, bg, removeBackground && !sourceHadTransparency) : null;
  const centroids: [number, number, number][] =
    colours === "full" ? [] : colours === "auto" ? auto!.inks : kmeans(samples, Math.max(1, Math.min(8, colours))).centroids;
  const erase = auto?.erase ?? [];
  const k = centroids.length;
  const out = Buffer.alloc(n * 4);
  let palette: string[] = [];

  if (k > 0) {
    palette = centroids.map((c) => hex(c[0], c[1], c[2]));
    let labels: Uint8Array = new Uint8Array(n);
    const useBlend = removeBackground && !sourceHadTransparency;
    for (let i = 0; i < n; i++) {
      if (alpha[i]! < 128) continue;
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const cc = centroids[c]!;
        const d = (r - cc[0]) ** 2 + (g - cc[1]) ** 2 + (b - cc[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      let label = best + 1;
      // Closer to fabric-in-shadow or an edge blend than to any thread: leave it off.
      if (erase.some((e) => (r - e[0]) ** 2 + (g - e[1]) ** 2 + (b - e[2]) ** 2 < bestD)) {
        labels[i] = 0;
        continue;
      }
      if (useBlend) {
        // Edge pixels are an ink faded into the fabric: give them to that ink (or drop them).
        for (let c = 0; c < centroids.length; c++) {
          const cc = centroids[c]!;
          const ax = cc[0] - bg[0];
          const ay = cc[1] - bg[1];
          const az = cc[2] - bg[2];
          const len2 = ax * ax + ay * ay + az * az;
          if (len2 < 1) continue;
          const t = ((r - bg[0]) * ax + (g - bg[1]) * ay + (b - bg[2]) * az) / len2;
          if (t <= 0.05 || t >= 0.95) continue;
          const resid = (r - bg[0] - t * ax) ** 2 + (g - bg[1] - t * ay) ** 2 + (b - bg[2] - t * az) ** 2;
          if (resid < bestD * 0.5 && resid < 400) {
            bestD = resid;
            label = t >= 0.45 ? c + 1 : 0;
          }
        }
      }
      labels[i] = label;
    }
    // An ink that ends up on under 0.6% of the design is noise: fold it into the nearest real ink.
    if (opts.colours === "auto" && centroids.length > 1) {
      const counts = new Array(centroids.length + 1).fill(0);
      for (let i = 0; i < n; i++) counts[labels[i]!]++;
      const inked = n - counts[0];
      const remap = centroids.map((_, c) => c + 1);
      const keepIdx = centroids.map((_, c) => c).filter((c) => counts[c + 1] / Math.max(1, inked) >= 0.006);
      if (keepIdx.length > 0 && keepIdx.length < centroids.length) {
        centroids.forEach((cc, c) => {
          if (keepIdx.includes(c)) return;
          let best = keepIdx[0]!;
          let bestD = Infinity;
          for (const k2 of keepIdx) {
            const o = centroids[k2]!;
            const d = (cc[0] - o[0]) ** 2 + (cc[1] - o[1]) ** 2 + (cc[2] - o[2]) ** 2;
            if (d < bestD) {
              bestD = d;
              best = k2;
            }
          }
          remap[c] = best + 1;
        });
        for (let i = 0; i < n; i++) if (labels[i]) labels[i] = remap[labels[i]! - 1]!;
        palette = keepIdx.map((c) => palette[c]!);
      }
    }
    labels = majorityFilter(labels, w, h);
    for (let i = 0; i < n; i++) {
      const l = labels[i]!;
      if (!l) continue;
      const c = centroids[l - 1]!;
      out[i * 4] = Math.round(c[0]);
      out[i * 4 + 1] = Math.round(c[1]);
      out[i * 4 + 2] = Math.round(c[2]);
      out[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < n; i++) {
      out[i * 4] = data[i * 4]!;
      out[i * 4 + 1] = data[i * 4 + 1]!;
      out[i * 4 + 2] = data[i * 4 + 2]!;
      out[i * 4 + 3] = alpha[i]!;
    }
    palette = kmeans(samples, Math.min(6, estimateColourCount(samples))).centroids.map((c) => hex(c[0], c[1], c[2]));
  }

  const keepsBackground = !removeBackground && !sourceHadTransparency;
  const trimmed = await (keepsBackground
    ? sharp(out, { raw: { width: w, height: h, channels: 4 } })
    : sharp(out, { raw: { width: w, height: h, channels: 4 } }).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }))
    .png()
    .toBuffer({ resolveWithObject: true })
    .catch(async () => sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer({ resolveWithObject: true }));

  return {
    png: trimmed.data,
    width: trimmed.info.width,
    height: trimmed.info.height,
    palette,
    flat: k > 0,
    backgroundHex: hex(bg[0], bg[1], bg[2]),
    sourceHadTransparency,
  };
}

export type PrintFile = { png: Buffer; widthPx: number; heightPx: number; widthIn: number; heightIn: number; dpi: number };

/** Smoothly upscales a 1-channel mask; always returns exactly tw×th bytes. */
async function upscaleMask(mask: Buffer, w: number, h: number, tw: number, th: number): Promise<Buffer> {
  const sigma = Math.min(3, Math.max(0.6, (tw / w) * 0.4));
  const { data, info } = await sharp(mask, { raw: { width: w, height: h, channels: 1 } })
    .resize({ width: tw, height: th, kernel: "lanczos3", fit: "fill" })
    .blur(sigma)
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels === 1 && data.length === tw * th) return data;
  const out = Buffer.alloc(tw * th);
  for (let i = 0; i < tw * th; i++) out[i] = data[i * info.channels]!;
  return out;
}

/** Upscales each colour's mask separately and keeps the strongest — clean, vector-like edges. */
async function crispFlatUpscale(raw: Raw, tw: number, th: number): Promise<Buffer> {
  const { data, width: w, height: h } = raw;
  const n = w * h;
  const colours = new Map<number, number>();
  const labels = new Uint8Array(n);
  const palette: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3]! < 128) continue;
    const key = (data[i * 4]! << 16) | (data[i * 4 + 1]! << 8) | data[i * 4 + 2]!;
    let l = colours.get(key);
    if (l === undefined) {
      if (palette.length >= 15) {
        l = 1;
      } else {
        palette.push([data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!]);
        l = palette.length;
        colours.set(key, l);
      }
    }
    labels[i] = l;
  }
  const tn = tw * th;
  const bestVal = new Uint8Array(tn);
  const bestLabel = new Uint8Array(tn);
  for (let l = 0; l <= palette.length; l++) {
    const mask = Buffer.alloc(n);
    for (let i = 0; i < n; i++) if (labels[i] === l) mask[i] = 255;
    const up = await upscaleMask(mask, w, h, tw, th);
    for (let i = 0; i < tn; i++) {
      const v = up[i]!;
      if (v > bestVal[i]!) {
        bestVal[i] = v;
        bestLabel[i] = l;
      }
    }
  }
  const out = Buffer.alloc(tn * 4);
  for (let i = 0; i < tn; i++) {
    const l = bestLabel[i]!;
    if (!l) continue;
    const c = palette[l - 1]!;
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

export async function renderPrintFile(
  master: Buffer,
  opts: { widthIn: number; maxWidthIn: number; maxHeightIn: number; mode: ColourMode; flat: boolean; inkHex?: string },
): Promise<PrintFile> {
  const raw = await toRaw(sharp(master));
  const aspect = raw.height / raw.width;
  let widthIn = Math.min(opts.widthIn, opts.maxWidthIn);
  let heightIn = widthIn * aspect;
  if (heightIn > opts.maxHeightIn) {
    heightIn = opts.maxHeightIn;
    widthIn = heightIn / aspect;
  }
  let tw = Math.max(1, Math.round(widthIn * PRINT_DPI));
  let th = Math.max(1, Math.round(heightIn * PRINT_DPI));

  let rgba: Buffer;
  if (opts.mode === "single") {
    const [r, g, b] = hexToRgb(opts.inkHex ?? "#ffffff");
    const mask = Buffer.alloc(raw.width * raw.height);
    for (let i = 0; i < mask.length; i++) mask[i] = raw.data[i * 4 + 3]! >= 128 ? 255 : 0;
    const up = await upscaleMask(mask, raw.width, raw.height, tw, th);
    rgba = Buffer.alloc(tw * th * 4);
    for (let i = 0; i < tw * th; i++) {
      if (up[i]! < 128) continue;
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b;
      rgba[i * 4 + 3] = 255;
    }
  } else if (opts.flat || opts.mode === "flat") {
    rgba = await crispFlatUpscale(raw, tw, th);
  } else {
    rgba = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
      .resize({ width: tw, height: th, kernel: "lanczos3" })
      .sharpen({ sigma: 0.7 })
      .raw()
      .toBuffer();
  }

  let dpi = PRINT_DPI;
  let png = await sharp(rgba, { raw: { width: tw, height: th, channels: 4 } })
    .png({ compressionLevel: 9 })
    .withMetadata({ density: dpi })
    .toBuffer();

  // Qikink accepts files up to 25 MB: very large full-colour prints are resampled, same physical size.
  if (png.length > QIKINK_MAX_FILE_BYTES) {
    const f = Math.sqrt(QIKINK_MAX_FILE_BYTES / png.length) * 0.95;
    tw = Math.round(tw * f);
    th = Math.round(th * f);
    dpi = Math.round(PRINT_DPI * f);
    png = await sharp(png).resize({ width: tw, height: th }).png({ compressionLevel: 9 }).withMetadata({ density: dpi }).toBuffer();
  }
  return { png, widthPx: tw, heightPx: th, widthIn: Math.round(widthIn * 10) / 10, heightIn: Math.round(heightIn * 10) / 10, dpi };
}

/* ───────────────────────────── Mockups ───────────────────────────── */

export async function renderMockup(
  art: Buffer,
  opts: { shape: GarmentShape; colourHex: string; placement: PlacementLocation; widthIn: number; heightIn: number },
): Promise<Buffer> {
  const view = opts.placement === "back" ? "back" : "front";
  const garment = await sharp(Buffer.from(garmentSvg(opts.shape, opts.colourHex, view))).png().toBuffer();
  const ppi = MOCKUP_PPI[opts.shape];
  const w = Math.max(8, Math.round(opts.widthIn * ppi));
  const h = Math.max(8, Math.round(opts.heightIn * ppi));
  const artImg = await sharp(art).resize({ width: w, height: h, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const { cx, top } = mockupAnchor(opts.shape, opts.placement);
  return sharp(garment)
    .composite([{ input: artImg, left: Math.round(cx - w / 2), top: Math.round(top) }])
    .webp({ quality: 88 })
    .toBuffer();
}

/** Source photo → web-friendly hero image for the store (max 1600px, WebP). */
export async function toStoreImage(source: Buffer): Promise<Buffer> {
  return sharp(source, { failOn: "none" })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86 })
    .toBuffer();
}
