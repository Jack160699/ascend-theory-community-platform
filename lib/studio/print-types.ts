/**
 * Qikink print types for apparel, from Qikink's API docs (print_type_id) and
 * Qikink's printing-charges page (qikink.com/help/payments-pricing/printing-charges).
 * Charges are in rupees before 5% GST.
 */

import type { PlacementLocation, PrintMethod } from "@/lib/wearables/design-types";

export type ColourMode = "full" | "flat" | "single";

export type StudioPrintType = {
  key: PrintMethod;
  label: string;
  qikinkId: number;
  blurb: string;
  colourMode: ColourMode;
  /** Single-colour finishes print in this colour regardless of the artwork's colours. */
  inkHex?: string;
  maxColours?: number;
  /** Only printable on these garment colours (lower-case names). */
  garmentColours?: string[];
  ratePerSqIn: { colourGarment: number; whiteGarment: number };
  minimumCharge: number;
  minimumChargeWhite?: number;
  /** Qikink limits per placement, in inches. */
  maxSize: Partial<Record<PlacementLocation, { w: number; h: number }>>;
  turnaroundNote?: string;
};

const CHEST = { w: 4, h: 4 };
const SHOULDER = { w: 3.5, h: 3.5 };

export const STUDIO_PRINT_TYPES: StudioPrintType[] = [
  {
    key: "dtg",
    label: "DTG print",
    qikinkId: 1,
    blurb: "Full colour, soft feel. Best for detailed artwork and photos.",
    colourMode: "full",
    ratePerSqIn: { colourGarment: 0.9, whiteGarment: 0.7 },
    minimumCharge: 100,
    minimumChargeWhite: 70,
    maxSize: { front: { w: 16, h: 20 }, back: { w: 16, h: 20 }, left_chest: CHEST, right_chest: CHEST, left_sleeve: SHOULDER, right_sleeve: SHOULDER },
  },
  {
    key: "dtf",
    label: "DTF print",
    qikinkId: 17,
    blurb: "Full colour, vivid and durable, slightly raised film.",
    colourMode: "full",
    ratePerSqIn: { colourGarment: 0.7, whiteGarment: 0.7 },
    minimumCharge: 80,
    maxSize: { front: { w: 18, h: 20 }, back: { w: 18, h: 20 }, left_chest: CHEST, right_chest: CHEST, left_sleeve: SHOULDER, right_sleeve: SHOULDER },
  },
  {
    key: "embroidery",
    label: "Embroidery",
    qikinkId: 3,
    blurb: "Stitched thread. Small logos and text only — max 3.5 × 3.5 in.",
    colourMode: "flat",
    maxColours: 6,
    ratePerSqIn: { colourGarment: 0, whiteGarment: 0 },
    minimumCharge: 100,
    maxSize: { left_chest: { w: 3.5, h: 3.5 }, right_chest: { w: 3.5, h: 3.5 }, front: { w: 3.5, h: 3.5 }, back: { w: 3.5, h: 3.5 } },
    turnaroundNote: "Qikink digitises embroidery files (about 2 days) before the first order.",
  },
  {
    key: "puff",
    label: "Puff print (white)",
    qikinkId: 6,
    blurb: "Raised 3D white print. Bold shapes and text work best.",
    colourMode: "single",
    inkHex: "#f5f5f0",
    ratePerSqIn: { colourGarment: 2, whiteGarment: 2 },
    minimumCharge: 100,
    maxSize: { front: { w: 12, h: 14 }, back: { w: 12, h: 14 }, left_chest: CHEST, right_chest: CHEST },
  },
  {
    key: "vinyl_gold",
    label: "Gold vinyl",
    qikinkId: 13,
    blurb: "Metallic gold, one colour.",
    colourMode: "single",
    inkHex: "#c9a23f",
    ratePerSqIn: { colourGarment: 1, whiteGarment: 1 },
    minimumCharge: 80,
    maxSize: { front: { w: 12, h: 14 }, back: { w: 12, h: 14 }, left_chest: CHEST, right_chest: CHEST },
  },
  {
    key: "vinyl_silver",
    label: "Silver vinyl",
    qikinkId: 14,
    blurb: "Metallic silver, one colour.",
    colourMode: "single",
    inkHex: "#c4c7cc",
    ratePerSqIn: { colourGarment: 1, whiteGarment: 1 },
    minimumCharge: 80,
    maxSize: { front: { w: 12, h: 14 }, back: { w: 12, h: 14 }, left_chest: CHEST, right_chest: CHEST },
  },
  {
    key: "glow",
    label: "Glow in the dark",
    qikinkId: 7,
    blurb: "Glows green in the dark, one colour.",
    colourMode: "single",
    inkHex: "#d8f5c9",
    ratePerSqIn: { colourGarment: 2, whiteGarment: 2 },
    minimumCharge: 80,
    maxSize: { front: { w: 12, h: 14 }, back: { w: 12, h: 14 }, left_chest: CHEST, right_chest: CHEST },
  },
  {
    key: "vinyl_reflective",
    label: "Reflective vinyl",
    qikinkId: 15,
    blurb: "Reflective grey that lights up under flash.",
    colourMode: "single",
    inkHex: "#a7a9ac",
    ratePerSqIn: { colourGarment: 1, whiteGarment: 1 },
    minimumCharge: 80,
    maxSize: { front: { w: 12, h: 14 }, back: { w: 12, h: 14 }, left_chest: CHEST, right_chest: CHEST },
  },
  {
    key: "sublimation",
    label: "Sublimation",
    qikinkId: 23,
    blurb: "Dyed into the fabric. White garments only.",
    colourMode: "full",
    garmentColours: ["white"],
    ratePerSqIn: { colourGarment: 0.3, whiteGarment: 0.3 },
    minimumCharge: 50,
    maxSize: { front: { w: 16, h: 20 }, back: { w: 16, h: 20 } },
  },
];

export const PLACEMENT_LABEL: Record<PlacementLocation, string> = {
  front: "Front",
  back: "Back",
  left_chest: "Left chest",
  right_chest: "Right chest",
  left_sleeve: "Left shoulder",
  right_sleeve: "Right shoulder",
  neck: "Back neck",
  custom: "Custom",
};

export function getPrintType(key: string): StudioPrintType | undefined {
  return STUDIO_PRINT_TYPES.find((t) => t.key === key);
}

/** A sensible starting print width for a placement, within Qikink's limit. */
export function defaultWidthIn(type: StudioPrintType, placement: PlacementLocation): number {
  const max = type.maxSize[placement];
  if (!max) return 3;
  if (placement === "front" || placement === "back") return Math.min(max.w, type.key === "embroidery" ? 3.5 : 11);
  return Math.min(max.w, 3.5);
}

/** Qikink print charge for one placement (₹, before GST). */
export function printChargeInr(type: StudioPrintType, widthIn: number, heightIn: number, whiteGarment: boolean): number {
  const rate = whiteGarment ? type.ratePerSqIn.whiteGarment : type.ratePerSqIn.colourGarment;
  const minimum = whiteGarment ? type.minimumChargeWhite ?? type.minimumCharge : type.minimumCharge;
  return Math.max(minimum, Math.round(widthIn * heightIn * rate));
}
