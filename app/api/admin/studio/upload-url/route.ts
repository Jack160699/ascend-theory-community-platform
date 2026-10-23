import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { db, errorResponse, requireStudioAdmin, UPLOAD_BUCKET } from "@/lib/studio/server";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Gives the browser a one-time URL to upload the photo/artwork straight to storage (no 4.5 MB limit). */
export async function POST(req: NextRequest) {
  const guard = await requireStudioAdmin();
  if (!guard.ok) return guard.response;
  try {
    const { contentType } = (await req.json()) as { contentType?: string };
    const ext = TYPES[contentType ?? ""];
    if (!ext) throw new Error("Upload a JPG, PNG or WebP image.");
    const day = new Date().toISOString().slice(0, 10);
    const path = `uploads/${day}/${randomUUID()}.${ext}`;
    const { data, error } = await db().storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Couldn't prepare the upload: ${error?.message ?? "unknown error"}`);
    return NextResponse.json({ ok: true, bucket: UPLOAD_BUCKET, path, token: data.token });
  } catch (err) {
    return errorResponse(err);
  }
}
