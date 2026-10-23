import { NextResponse, type NextRequest } from "next/server";
import { publishDesign, type PublishInput } from "@/lib/studio/publish";
import { errorResponse, requireStudioAdmin } from "@/lib/studio/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const guard = await requireStudioAdmin();
  if (!guard.ok) return guard.response;
  try {
    const input = (await req.json()) as PublishInput;
    const result = await publishDesign(input, guard.admin.id || null);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
