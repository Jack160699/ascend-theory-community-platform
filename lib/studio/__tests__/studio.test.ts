import { describe, it } from "node:test";
import assert from "node:assert";
import sharp from "sharp";
import { normaliseAnalysis } from "../ai";
import { DEFAULT_GARMENTS } from "../garments";
import { estimateCostInr, parseQikinkSku, qikinkSku, suggestedPriceInr } from "../pricing";
import { getPrintType, printChargeInr, defaultWidthIn, STUDIO_PRINT_TYPES } from "../print-types";
import { validatePublish, type PublishInput } from "../publish";
import { extractArtwork, renderPrintFile, renderMockup, isFabricBlend } from "../image";
import { designCode, printTypeId, placementSku } from "../../fulfillment/qikink";

const hoodie = DEFAULT_GARMENTS.find((g) => g.key === "hoodie")!;

describe("Studio — Qikink print types and SKUs", () => {
  it("uses Qikink's documented print_type_id values and placement codes", () => {
    assert.strictEqual(printTypeId("dtg"), 1);
    assert.strictEqual(printTypeId("embroidery"), 3);
    assert.strictEqual(printTypeId("puff"), 6);
    assert.strictEqual(printTypeId("dtf"), 17);
    assert.strictEqual(printTypeId("sublimation"), 23);
    assert.strictEqual(placementSku("left_chest"), "lp");
    assert.strictEqual(placementSku("left_sleeve"), "ls");
    STUDIO_PRINT_TYPES.forEach((t) => assert.strictEqual(printTypeId(t.key), t.qikinkId));
  });

  it("keeps design codes within Qikink's 20-character limit and changes them per version", () => {
    const a = designCode("1a2b3c4d-5e6f-7a8b-9c0d-112233445566", 1, "fr");
    const b = designCode("1a2b3c4d-5e6f-7a8b-9c0d-112233445566", 2, "fr");
    assert.ok(a.length <= 20);
    assert.notStrictEqual(a, b);
    assert.match(a, /^AT1a2b3c4dv1fr$/);
  });

  it("builds and reads Qikink SKUs", () => {
    assert.strictEqual(qikinkSku(hoodie, hoodie.colours[0]!, hoodie.sizes[1]!), "UPuHd-Bk-M");
    assert.deepStrictEqual(parseQikinkSku(" UPuHd-Wh-XS "), { prefix: "UPuHd", colourCode: "Wh", sizeCode: "XS" });
    assert.strictEqual(parseQikinkSku("not a sku"), null);
  });

  it("prices print charges from Qikink's rate card (minimums apply)", () => {
    const dtg = getPrintType("dtg")!;
    assert.strictEqual(printChargeInr(dtg, 12, 14, false), Math.round(12 * 14 * 0.9));
    assert.strictEqual(printChargeInr(dtg, 3, 3, false), 100);
    assert.strictEqual(printChargeInr(dtg, 3, 3, true), 70);
    assert.strictEqual(printChargeInr(getPrintType("embroidery")!, 3.5, 3.5, false), 100);
    assert.strictEqual(defaultWidthIn(getPrintType("embroidery")!, "left_chest"), 3.5);
  });

  it("estimates the per-piece cost and suggests ₹…99 prices", () => {
    const cost = estimateCostInr(hoodie, "Black", [{ printType: "embroidery", widthIn: 3.5, heightIn: 3 }]);
    assert.strictEqual(cost.garment, 480);
    assert.strictEqual(cost.print, 100);
    assert.strictEqual(cost.gst, 29);
    assert.strictEqual(cost.shipping, 127); // 650 g → two 500 g slabs
    assert.strictEqual(cost.total, 736);
    const p = suggestedPriceInr(cost.total, 0.6);
    assert.ok(p % 100 === 99 && p >= 736 / 0.4);
  });
});

describe("Studio — detection results", () => {
  it("normalises Claude's pixel boxes and fills safe defaults", () => {
    const a = normaliseAnalysis(
      {
        image_kind: "worn_photo",
        garment: { type: "hoodie", colour_name: "Black", colour_hex: "#111111" },
        designs: [
          { label: "Crest", placement: "left_chest", technique: "embroidery", style: "flat_graphic", colour_count: 3, colours_hex: ["#c9a23f", "bad"], box: { x0: 800, y0: 300, x1: 600, y1: 500 }, description: "" },
          { label: "Speck", box: { x0: 1, y0: 1, x1: 2, y1: 2 } },
        ],
        suggested_title: "Gold Crest Hoodie",
        suggested_description: "Embroidered crest.",
        rights: { may_contain_third_party_ip: false, details: "" },
      },
      1000,
      1000,
    );
    assert.strictEqual(a.designs.length, 1, "tiny boxes are dropped");
    assert.deepStrictEqual(a.designs[0]!.box, { x0: 0.6, y0: 0.3, x1: 0.8, y1: 0.5 });
    assert.deepStrictEqual(a.designs[0]!.coloursHex, ["#c9a23f"]);
    assert.strictEqual(a.garment.type, "hoodie");
  });
});

describe("Studio — publish validation", () => {
  const base: PublishInput = {
    sourcePath: "normalised/a.jpg",
    artworkPath: "extracted/b.png",
    flat: true,
    useSourcePhoto: true,
    title: "Gold Crest Hoodie",
    description: "",
    garmentKey: "hoodie",
    colours: ["Black"],
    sizes: ["S", "M"],
    printType: "embroidery",
    placement: "left_chest",
    widthIn: 3.5,
    price: 1499,
    currency: "INR",
    status: "active",
    rightsConfirmed: true,
  };

  it("accepts a complete product", () => {
    const v = validatePublish(base, hoodie);
    assert.strictEqual(v.maxW, 3.5);
  });

  it("requires the rights confirmation, a price and a valid placement", () => {
    assert.throws(() => validatePublish({ ...base, rightsConfirmed: false }, hoodie), /permission/);
    assert.throws(() => validatePublish({ ...base, price: 0 }, hoodie), /price/);
    assert.throws(() => validatePublish({ ...base, placement: "left_sleeve" }, hoodie), /isn't available/);
    assert.throws(() => validatePublish({ ...base, sourcePath: "../../etc/passwd" }, hoodie), /Upload/);
  });

  it("blocks sublimation on dark garments and unknown colours", () => {
    const tee = DEFAULT_GARMENTS.find((g) => g.key === "tee")!;
    assert.throws(() => validatePublish({ ...base, garmentKey: "tee", printType: "sublimation", placement: "front", widthIn: 10 }, tee), /only works on white/);
    assert.throws(() => validatePublish({ ...base, colours: ["Purple"] }, hoodie), /isn't set up/);
  });
});

describe("Studio — image pipeline", () => {
  async function photo(): Promise<Buffer> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
      <rect width="800" height="800" fill="#1b1b1d"/>
      <circle cx="400" cy="380" r="150" fill="none" stroke="#c9a23f" stroke-width="26"/>
      <rect x="360" y="300" width="80" height="160" fill="#b8202a"/>
    </svg>`;
    return sharp(Buffer.from(svg)).blur(1).jpeg({ quality: 85 }).toBuffer();
  }

  it("extracts a flat 2-colour design from fabric and drops edge blends", async () => {
    const res = await extractArtwork(await photo(), { x0: 0.25, y0: 0.22, x1: 0.75, y1: 0.73 }, { colours: "auto", tolerance: 35 });
    assert.strictEqual(res.flat, true);
    assert.strictEqual(res.palette.length, 2, `palette ${res.palette.join(",")}`);
    const meta = await sharp(res.png).metadata();
    assert.strictEqual(meta.hasAlpha, true);
  });

  it("keeps the background when removal is off", async () => {
    const res = await extractArtwork(await photo(), { x0: 0, y0: 0, x1: 1, y1: 1 }, { colours: "full", tolerance: 0 });
    assert.ok(res.width >= 790 && res.height >= 790);
  });

  it("renders Qikink print files at 300 DPI within the print area", async () => {
    const res = await extractArtwork(await photo(), { x0: 0.25, y0: 0.22, x1: 0.75, y1: 0.73 }, { colours: 2, tolerance: 35 });
    const file = await renderPrintFile(res.png, { widthIn: 5, maxWidthIn: 3.5, maxHeightIn: 3.5, mode: "flat", flat: true });
    assert.ok(file.widthIn <= 3.5 && file.heightIn <= 3.5);
    assert.strictEqual(file.dpi, 300);
    const meta = await sharp(file.png).metadata();
    assert.strictEqual(meta.density, 300);
    assert.strictEqual(meta.width, file.widthPx);
    const single = await renderPrintFile(res.png, { widthIn: 3, maxWidthIn: 12, maxHeightIn: 14, mode: "single", flat: true, inkHex: "#f5f5f0" });
    const stats = await sharp(single.png).stats();
    assert.ok(stats.channels[0]!.max <= 245 + 10, "single-colour file uses the ink colour");
    const mock = await renderMockup(file.png, { shape: "hoodie", colourHex: "#151515", placement: "left_chest", widthIn: file.widthIn, heightIn: file.heightIn });
    assert.strictEqual((await sharp(mock).metadata()).format, "webp");
  });

  it("recognises anti-aliased edge colours as fabric blends", () => {
    assert.strictEqual(isFabricBlend([110, 92, 50], [[201, 162, 63]], [27, 27, 29]), true);
    assert.strictEqual(isFabricBlend([184, 32, 42], [[201, 162, 63]], [27, 27, 29]), false);
  });
});
