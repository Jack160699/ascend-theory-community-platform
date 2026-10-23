/** Server helpers shared by the studio API routes: auth, storage and slugs. */

import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/auth";
import type { AdminUser } from "@/lib/admin/auth-shared";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const UPLOAD_BUCKET = "studio-uploads";
export const ARTWORK_BUCKET = "design-artwork";
export const MEDIA_BUCKET = "product-media";

type Guard = { ok: true; admin: AdminUser } | { ok: false; response: NextResponse };

/** Studio changes the live catalogue, so only owners and admins may use it. */
export async function requireStudioAdmin(): Promise<Guard> {
  const admin = await getAdminSession();
  if (!admin) return { ok: false, response: NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 }) };
  if (!["owner", "admin"].includes(admin.role)) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Only owners and admins can publish products." }, { status: 403 }) };
  }
  return { ok: true, admin };
}

export function db() {
  const client = createSupabaseServiceClient();
  if (!client) throw new Error("Database isn't configured (SUPABASE_SERVICE_ROLE_KEY missing).");
  return client;
}

/** Paths the browser may hand back to us: only files the studio itself created. */
export function isStudioPath(path: unknown): path is string {
  return typeof path === "string" && /^(uploads|normalised|extracted)\/[A-Za-z0-9/_.-]+$/.test(path) && !path.includes("..");
}

export async function downloadFile(bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await db().storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Couldn't read ${path}: ${error?.message ?? "not found"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function uploadFile(bucket: string, path: string, body: Buffer, contentType: string): Promise<void> {
  const { error } = await db().storage.from(bucket).upload(path, body, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`Couldn't save ${path}: ${error.message}`);
}

export async function signedUrl(bucket: string, path: string, seconds = 3600): Promise<string> {
  const { data, error } = await db().storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new Error(`Couldn't create a link for ${path}`);
  return data.signedUrl;
}

export function publicUrl(bucket: string, path: string): string {
  return db().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "design"
  );
}

export function errorResponse(err: unknown, status = 400): NextResponse {
  const message = err instanceof Error ? err.message : "Something went wrong";
  console.error("[studio]", message);
  return NextResponse.json({ ok: false, error: message }, { status });
}
