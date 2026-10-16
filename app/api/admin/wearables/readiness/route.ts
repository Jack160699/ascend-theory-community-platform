import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { getProductReadinessReportsAdmin } from "@/lib/wearables/design-store";

export async function GET() {
  try {
    await requireAdmin();
    const reports = await getProductReadinessReportsAdmin();
    return NextResponse.json({ ok: true, reports });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("Unauthorized") ? 401 : 500 });
  }
}
