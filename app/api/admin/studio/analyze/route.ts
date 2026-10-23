import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { analyzeDesignImage, isStudioAiAvailable, type DesignAnalysis } from "@/lib/studio/ai";
import {
  downloadFile,
  errorResponse,
  isStudioPath,
  requireStudioAdmin,
  signedUrl,
  uploadFile,
  UPLOAD_BUCKET,
} from "@/lib/studio/server";

export const maxDuration = 60;

/** Normalises the upload (upright, ≤4000px) and asks Claude where the design is. */
export async function POST(req: NextRequest) {
  const guard = await requireStudioAdmin();
  if (!guard.ok) return guard.response;
  try {
    const { path } = (await req.json()) as { path?: string };
    if (!isStudioPath(path) || !path.startsWith("uploads/")) throw new Error("Upload the image first.");

    const original = await downloadFile(UPLOAD_BUCKET, path);
    const img = sharp(original, { failOn: "none" }).rotate().resize({ width: 4000, height: 4000, fit: "inside", withoutEnlargement: true });
    const meta = await sharp(original, { failOn: "none" }).metadata();
    const keepAlpha = Boolean(meta.hasAlpha);
    const normalised = keepAlpha
      ? await img.png().toBuffer({ resolveWithObject: true })
      : await img.jpeg({ quality: 93 }).toBuffer({ resolveWithObject: true });
    const ext = keepAlpha ? "png" : "jpg";
    const sourcePath = `normalised/${randomUUID()}.${ext}`;
    await uploadFile(UPLOAD_BUCKET, sourcePath, normalised.data, keepAlpha ? "image/png" : "image/jpeg");

    let analysis: DesignAnalysis | null = null;
    let aiError: string | undefined;
    if (isStudioAiAvailable()) {
      try {
        analysis = await analyzeDesignImage(normalised.data);
      } catch (err) {
        aiError = err instanceof Error ? err.message : "Detection failed";
      }
    }

    return NextResponse.json({
      ok: true,
      sourcePath,
      previewUrl: await signedUrl(UPLOAD_BUCKET, sourcePath, 6 * 3600),
      width: normalised.info.width,
      height: normalised.info.height,
      hasTransparency: keepAlpha,
      aiAvailable: isStudioAiAvailable(),
      aiError,
      analysis,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
