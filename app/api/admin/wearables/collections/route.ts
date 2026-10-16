import { NextResponse } from "next/server";
import { getAdminSession, hasPermission } from "@/lib/admin/auth";
import { getAllCollectionsAdmin, saveCollectionAdmin } from "@/lib/wearables/store";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const collections = await getAllCollectionsAdmin();
  return NextResponse.json({ collections });
}

export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.role, "wearables", "write")) {
    return NextResponse.json(
      { error: "Forbidden: Role does not have write permission for wearables collections" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const result = await saveCollectionAdmin(body, session.id);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ collection: result.collection });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
