import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireRole } from "@/lib/admin/auth";
import { getAllDesignsAdmin, saveDesignAdmin } from "@/lib/wearables/design-store";

export async function GET() {
  try {
    await requireAdmin();
    const designs = await getAllDesignsAdmin();
    return NextResponse.json({ ok: true, designs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("Unauthorized") ? 401 : 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireRole("admin");
    const body = await req.json();

    const result = await saveDesignAdmin(
      {
        design: body.design || body,
        placements: body.placements || [],
      },
      profile.id
    );

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, errors: result.errors }, { status: 400 });
    }

    return NextResponse.json({ ok: true, design: result.design });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("Unauthorized") ? 401 : 500 });
  }
}
