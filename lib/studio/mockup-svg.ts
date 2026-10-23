/**
 * Garment illustrations for mockups — plain SVG, shared by the server (rasterised with sharp)
 * and the HQ studio (live preview in the browser).
 */

import type { PlacementLocation } from "@/lib/wearables/design-types";

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  const n = m ? parseInt(m[1]!, 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}


export type GarmentShape = "tee" | "oversized_tee" | "hoodie" | "sweatshirt";

export const MOCKUP_CANVAS = { w: 1000, h: 1200 };
/** Pixels per inch on the mockup illustration (chest ≈ 21–24 in across). */
export const MOCKUP_PPI: Record<GarmentShape, number> = { tee: 25, oversized_tee: 22, hoodie: 23, sweatshirt: 23 };

function luminance(hexColour: string): number {
  const [r, g, b] = hexToRgb(hexColour);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function shade(hexColour: string, amount: number): string {
  const [r, g, b] = hexToRgb(hexColour);
  const f = (v: number) => (amount < 0 ? v * (1 + amount) : v + (255 - v) * amount);
  return hex(f(r), f(g), f(b));
}

function garmentPaths(shape: GarmentShape, view: "front" | "back"): { body: string; details: string } {
  const neckFront = "M410,150 Q500,222 590,150";
  const neckBack = "M410,150 Q500,172 590,150";
  const neck = view === "front" ? neckFront : neckBack;
  switch (shape) {
    case "tee":
      return {
        body: `${neck} L748,186 L892,432 L786,486 L712,418 L716,1082 Q500,1100 284,1082 L288,418 L214,486 L108,432 L252,186 Z`,
        details: `<path d="${neck}" fill="none" stroke="SHADE" stroke-width="10"/>`,
      };
    case "oversized_tee":
      return {
        body: `${neck} L770,205 L905,520 L790,575 L742,470 L748,1095 Q500,1112 252,1095 L258,470 L210,575 L95,520 L230,205 Z`,
        details: `<path d="${neck}" fill="none" stroke="SHADE" stroke-width="12"/>`,
      };
    case "hoodie": {
      const body = `M405,165 Q392,96 440,70 Q500,44 560,70 Q608,96 595,165 L752,200 L835,960 L842,1030 L752,1030 L742,960 L712,470 L716,1050 Q500,1066 284,1050 L288,470 L258,960 L248,1030 L158,1030 L165,960 L248,200 Z`;
      const hood =
        view === "front"
          ? `<path d="M405,168 Q430,128 500,124 Q570,128 595,168 Q560,262 500,270 Q440,262 405,168 Z" fill="SHADE" stroke="SHADE" stroke-width="3"/>
             <path d="M405,168 Q440,236 500,246 Q560,236 595,168" fill="none" stroke="LIGHT" stroke-width="5" opacity="0.6"/>
             <path d="M468,218 L462,420 M532,218 L538,420" stroke="LIGHT" stroke-width="7" stroke-linecap="round"/>
             <path d="M352,770 L648,770 Q676,860 690,952 L310,952 Q324,860 352,770 Z" fill="none" stroke="SHADE" stroke-width="5"/>`
          : `<path d="M360,190 Q350,40 500,30 Q650,40 640,190 Q600,330 500,345 Q400,330 360,190 Z" fill="BASE" stroke="SHADE" stroke-width="5"/>`;
      return { body, details: `${hood}<path d="M284,1010 Q500,1026 716,1010" stroke="SHADE" stroke-width="6" fill="none"/>` };
    }
    case "sweatshirt":
      return {
        body: `${neck} L752,198 L835,960 L842,1030 L752,1030 L742,960 L712,470 L716,1050 Q500,1066 284,1050 L288,470 L258,960 L248,1030 L158,1030 L165,960 L248,198 Z`,
        details: `<path d="${neck}" fill="none" stroke="SHADE" stroke-width="16"/><path d="M284,1010 Q500,1026 716,1010" stroke="SHADE" stroke-width="6" fill="none"/>`,
      };
  }
}

export function garmentSvg(shape: GarmentShape, colourHex: string, view: "front" | "back"): string {
  const dark = luminance(colourHex) < 0.35;
  const shadeHex = dark ? shade(colourHex, 0.12) : shade(colourHex, -0.14);
  const light = dark ? shade(colourHex, 0.3) : shade(colourHex, -0.25);
  const { body, details } = garmentPaths(shape, view);
  const d = details.replaceAll("BASE", colourHex).replaceAll("SHADE", shadeHex).replaceAll("LIGHT", light);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MOCKUP_CANVAS.w}" height="${MOCKUP_CANVAS.h}" viewBox="0 0 ${MOCKUP_CANVAS.w} ${MOCKUP_CANVAS.h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efede9"/><stop offset="1" stop-color="#dedbd5"/></linearGradient>
    <linearGradient id="fold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0.16"/><stop offset="0.22" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0.07"/><stop offset="0.78" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.18"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <ellipse cx="500" cy="1120" rx="330" ry="26" fill="#000" opacity="0.08"/>
  <path d="${body}" fill="${colourHex}" stroke="${shadeHex}" stroke-width="3"/>
  ${d}
  <path d="${body}" fill="url(#fold)"/>
</svg>`;
}

/** Where a placement sits on the illustration: centre x and top y, in canvas pixels. */
export function mockupAnchor(shape: GarmentShape, placement: PlacementLocation): { cx: number; top: number } {
  const chestTop = shape === "hoodie" ? 300 : 280;
  switch (placement) {
    case "left_chest":
      return { cx: 612, top: chestTop - 10 };
    case "right_chest":
      return { cx: 388, top: chestTop - 10 };
    case "left_sleeve":
      return { cx: 800, top: 300 };
    case "right_sleeve":
      return { cx: 200, top: 300 };
    case "back":
      return { cx: 500, top: shape === "hoodie" ? 380 : 250 };
    default:
      return { cx: 500, top: chestTop };
  }
}

