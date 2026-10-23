import { NextResponse, type NextRequest } from "next/server";
import { listGarments, updateGarment, type GarmentUpdate } from "@/lib/studio/garments";
import { STUDIO_PRINT_TYPES } from "@/lib/studio/print-types";
import { errorResponse, requireStudioAdmin } from "@/lib/studio/server";

export async function GET() {
  const guard = await requireStudioAdmin();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ ok: true, garments: await listGarments(), printTypes: STUDIO_PRINT_TYPES });
  } catch (err) {
    return errorResponse(err, 500);
  }
}

export async function PUT(req: NextRequest) {
  const guard = await requireStudioAdmin();
  if (!guard.ok) return guard.response;
  try {
    const { key, ...update } = (await req.json()) as GarmentUpdate & { key?: string };
    if (!key) throw new Error("Which garment?");
    return NextResponse.json({ ok: true, garment: await updateGarment(key, update) });
  } catch (err) {
    return errorResponse(err);
  }
}
