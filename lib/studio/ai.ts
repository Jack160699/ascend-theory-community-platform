/**
 * Design detection with Claude (vision). Given a photo of a garment or a flat artwork,
 * returns the garment, every print/embroidery on it with a bounding box, and a short
 * product title and description. Needs ANTHROPIC_API_KEY; without it the studio falls
 * back to drawing the box by hand.
 */

import sharp from "sharp";

export const STUDIO_AI_MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";
const ANALYSIS_MAX_EDGE = 1568;

export type DetectedDesign = {
  label: string;
  placement: "front" | "back" | "left_chest" | "right_chest" | "left_sleeve" | "right_sleeve";
  technique: "embroidery" | "print" | "puff" | "metallic_vinyl" | "glow" | "unknown";
  style: "flat_graphic" | "text" | "photographic" | "mixed";
  colourCount: number;
  coloursHex: string[];
  /** Normalised 0–1 box on the original image. */
  box: { x0: number; y0: number; x1: number; y1: number };
  description: string;
};

export type DesignAnalysis = {
  imageKind: "worn_photo" | "flat_lay_photo" | "mockup" | "artwork_file";
  garment: { type: "tee" | "oversized_tee" | "hoodie" | "sweatshirt" | "other" | "none"; colourName: string; colourHex: string };
  designs: DetectedDesign[];
  suggestedTitle: string;
  suggestedDescription: string;
  rights: { mayContainThirdPartyIp: boolean; details: string };
};

export function isStudioAiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const TOOL = {
  name: "report_design",
  description: "Report the garment and every printed or embroidered design visible in the image.",
  input_schema: {
    type: "object",
    properties: {
      image_kind: { type: "string", enum: ["worn_photo", "flat_lay_photo", "mockup", "artwork_file"] },
      garment: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["tee", "oversized_tee", "hoodie", "sweatshirt", "other", "none"] },
          colour_name: { type: "string", description: "Plain colour name, e.g. Black, White, Navy Blue." },
          colour_hex: { type: "string", description: "#RRGGBB of the fabric." },
        },
        required: ["type", "colour_name", "colour_hex"],
      },
      designs: {
        type: "array",
        description: "Each separate artwork, logo or text block on the garment (or the whole artwork for an artwork file).",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short name, e.g. 'Rose crest' or 'ASCEND wordmark'." },
            placement: { type: "string", enum: ["front", "back", "left_chest", "right_chest", "left_sleeve", "right_sleeve"] },
            technique: { type: "string", enum: ["embroidery", "print", "puff", "metallic_vinyl", "glow", "unknown"] },
            style: { type: "string", enum: ["flat_graphic", "text", "photographic", "mixed"] },
            colour_count: { type: "integer", description: "Distinct ink/thread colours, excluding the fabric." },
            colours_hex: { type: "array", items: { type: "string" } },
            box: {
              type: "object",
              description: "Tight pixel bounding box around the design in the image as given.",
              properties: { x0: { type: "number" }, y0: { type: "number" }, x1: { type: "number" }, y1: { type: "number" } },
              required: ["x0", "y0", "x1", "y1"],
            },
            description: { type: "string" },
          },
          required: ["label", "placement", "technique", "style", "colour_count", "colours_hex", "box", "description"],
        },
      },
      suggested_title: { type: "string", description: "Product name under 40 characters, no brand names." },
      suggested_description: { type: "string", description: "Two short sentences for the product page." },
      rights: {
        type: "object",
        properties: {
          may_contain_third_party_ip: {
            type: "boolean",
            description: "True if the design shows a known brand logo, trademark, sports team, film/TV/game character or celebrity likeness.",
          },
          details: { type: "string", description: "What was recognised, or empty." },
        },
        required: ["may_contain_third_party_ip", "details"],
      },
    },
    required: ["image_kind", "garment", "designs", "suggested_title", "suggested_description", "rights"],
  },
} as const;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

type RawDesign = {
  label?: string;
  placement?: DetectedDesign["placement"];
  technique?: DetectedDesign["technique"];
  style?: DetectedDesign["style"];
  colour_count?: number;
  colours_hex?: string[];
  box?: { x0: number; y0: number; x1: number; y1: number };
  description?: string;
};

type RawAnalysis = {
  image_kind?: DesignAnalysis["imageKind"];
  garment?: { type?: DesignAnalysis["garment"]["type"]; colour_name?: string; colour_hex?: string };
  designs?: RawDesign[];
  suggested_title?: string;
  suggested_description?: string;
  rights?: { may_contain_third_party_ip?: boolean; details?: string };
};

/** Turns the model's pixel boxes (on the resized image) into clean normalised boxes. */
export function normaliseAnalysis(raw: RawAnalysis, sentWidth: number, sentHeight: number): DesignAnalysis {
  const designs: DetectedDesign[] = (raw.designs ?? [])
    .map((d) => {
      const b = d.box ?? { x0: 0, y0: 0, x1: sentWidth, y1: sentHeight };
      const x0 = clamp01(Math.min(b.x0, b.x1) / sentWidth);
      const x1 = clamp01(Math.max(b.x0, b.x1) / sentWidth);
      const y0 = clamp01(Math.min(b.y0, b.y1) / sentHeight);
      const y1 = clamp01(Math.max(b.y0, b.y1) / sentHeight);
      return {
        label: d.label?.trim() || "Design",
        placement: d.placement ?? "front",
        technique: d.technique ?? "unknown",
        style: d.style ?? "flat_graphic",
        colourCount: Math.max(1, Math.min(32, Math.round(d.colour_count ?? 3))),
        coloursHex: (d.colours_hex ?? []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 12),
        box: { x0, y0, x1, y1 },
        description: d.description?.trim() ?? "",
      };
    })
    .filter((d) => d.box.x1 - d.box.x0 > 0.01 && d.box.y1 - d.box.y0 > 0.01);

  return {
    imageKind: raw.image_kind ?? "worn_photo",
    garment: {
      type: raw.garment?.type ?? "other",
      colourName: raw.garment?.colour_name?.trim() || "Black",
      colourHex: /^#[0-9a-fA-F]{6}$/.test(raw.garment?.colour_hex ?? "") ? raw.garment!.colour_hex! : "#151515",
    },
    designs,
    suggestedTitle: (raw.suggested_title ?? "").trim().slice(0, 60),
    suggestedDescription: (raw.suggested_description ?? "").trim().slice(0, 400),
    rights: {
      mayContainThirdPartyIp: Boolean(raw.rights?.may_contain_third_party_ip),
      details: raw.rights?.details?.trim() ?? "",
    },
  };
}

export async function analyzeDesignImage(image: Buffer): Promise<DesignAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const resized = await sharp(image)
    .rotate()
    .resize({ width: ANALYSIS_MAX_EDGE, height: ANALYSIS_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#808080" })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = resized.info;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: STUDIO_AI_MODEL,
      max_tokens: 2000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: resized.data.toString("base64") } },
            {
              type: "text",
              text:
                `This image is ${width}×${height} pixels. An apparel brand wants to turn the design in it into a print-on-demand product. ` +
                "Find every printed, embroidered or applied design on the garment (or, for a flat artwork file, the artwork itself). " +
                "Give a tight pixel box around each design in this image's coordinates — include the whole design, not the garment. " +
                "Say how it is made (embroidery shows raised thread texture; prints are flat) and where it sits on the garment. " +
                "Flag known brand logos, trademarks, team crests or characters honestly. Then call report_design.",
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const body = (await res.json().catch(() => null)) as {
    content?: { type: string; name?: string; input?: RawAnalysis }[];
    error?: { message?: string };
  } | null;
  if (!res.ok || !body) {
    throw new Error(`Design detection failed: ${body?.error?.message ?? `HTTP ${res.status}`}`);
  }
  const call = body.content?.find((c) => c.type === "tool_use" && c.name === TOOL.name);
  if (!call?.input) throw new Error("Design detection returned no result");
  return normaliseAnalysis(call.input, width, height);
}
