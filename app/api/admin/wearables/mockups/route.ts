import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireRole } from "@/lib/admin/auth";
import { getAllMockupsAdmin, saveMockupAdmin, setMockupStatusAdmin } from "@/lib/wearables/design-store";

export async function GET() {
  try {
    await requireAdmin();
    const mockups = await getAllMockupsAdmin();
    return NextResponse.json({ ok: true, mockups });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("Unauthorized") ? 401 : 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireRole("admin");
    const body = await req.json();

    const result = await saveMockupAdmin(body, profile.id);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, mockup: result.mockup });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("Unauthorized") ? 401 : 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const profile = await requireRole("admin");
    const body = await req.json();
    const { mockupId, status } = body;

    if (!mockupId || !["approved", "rejected", "draft"].includes(status)) {
      return NextResponse.json({ ok: false, error: "mockupId and valid status are required" }, { status: 400 });
    }

    const result = await setMockupStatusAdmin(mockupId, status, profile.id);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("Unauthorized") ? 401 : 500 });
  }
}
