import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin/auth";
import { validateArtworkUpload } from "@/lib/wearables/design-storage";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/env";

export async function POST(req: NextRequest) {
  try {
    await requireRole("admin");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
    }

    const fileSizeBytes = file.size;
    const mimeType = file.type;

    const valRes = validateArtworkUpload({ mimeType, fileSizeBytes });
    if (!valRes.isValid) {
      return NextResponse.json({ ok: false, error: valRes.error }, { status: 400 });
    }

    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_").toLowerCase();
    const datePrefix = new Date().toISOString().slice(0, 10);
    const storagePath = `artwork/${datePrefix}/${crypto.randomUUID()}-${sanitizedFilename}`;

    if (hasSupabaseConfig()) {
      const serviceClient = createSupabaseServiceClient();
      if (!serviceClient) {
        return NextResponse.json({ ok: false, error: "Server storage client unavailable" }, { status: 500 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadErr } = await serviceClient.storage
        .from("design-artwork")
        .upload(storagePath, buffer, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadErr) {
        return NextResponse.json({ ok: false, error: `Artwork upload failed: ${uploadErr.message}` }, { status: 500 });
      }

      const { data: signedData, error: signErr } = await serviceClient.storage
        .from("design-artwork")
        .createSignedUrl(storagePath, 3600);

      const previewUrl = signErr || !signedData ? undefined : signedData.signedUrl;

      return NextResponse.json({
        ok: true,
        storagePath,
        previewUrl,
        originalFilename: file.name,
        mimeType,
        fileSizeBytes,
      });
    }

    // Local Dev Memory Fallback
    const mockPreviewUrl = `https://storage.ascendtheory.local/${storagePath}`;
    return NextResponse.json({
      ok: true,
      storagePath,
      previewUrl: mockPreviewUrl,
      originalFilename: file.name,
      mimeType,
      fileSizeBytes,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("Unauthorized") ? 401 : 500 });
  }
}
