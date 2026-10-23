import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { extractArtwork, type NormBox } from "@/lib/studio/image";
import { downloadFile, errorResponse, isStudioPath, requireStudioAdmin, signedUrl, uploadFile, UPLOAD_BUCKET } from "@/lib/studio/server";

export const maxDuration = 60;

function validBox(b: unknown): b is NormBox {
  if (!b || typeof b !== "object") return false;
  const { x0, y0, x1, y1 } = b as NormBox;
  return [x0, y0, x1, y1].every((v) => typeof v === "number" && v >= 0 && v <= 1) && x1 - x0 > 0.005 && y1 - y0 > 0.005;
}

/** Cuts the design out of the photo and cleans it into artwork. */
export async function POST(req: NextRequest) {
  const guard = await requireStudioAdmin();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json()) as { sourcePath?: string; box?: NormBox; colours?: "auto" | "full" | number; tolerance?: number };
    if (!isStudioPath(body.sourcePath) || !body.sourcePath.startsWith("normalised/")) throw new Error("Upload the image first.");
    if (!validBox(body.box)) throw new Error("Draw a box around the design.");
    const colours =
      body.colours === "full" || body.colours === "auto"
        ? body.colours
        : Number.isInteger(body.colours) && Number(body.colours) >= 1 && Number(body.colours) <= 8
          ? Number(body.colours)
          : "auto";
    const tolerance = Math.max(0, Math.min(100, Number(body.tolerance ?? 35)));

    const source = await downloadFile(UPLOAD_BUCKET, body.sourcePath);
    const result = await extractArtwork(source, body.box, { colours, tolerance });
    const artworkPath = `extracted/${randomUUID()}.png`;
    await uploadFile(UPLOAD_BUCKET, artworkPath, result.png, "image/png");

    return NextResponse.json({
      ok: true,
      artworkPath,
      previewUrl: await signedUrl(UPLOAD_BUCKET, artworkPath, 6 * 3600),
      width: result.width,
      height: result.height,
      palette: result.palette,
      flat: result.flat,
      backgroundHex: result.backgroundHex,
      sourceHadTransparency: result.sourceHadTransparency,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
