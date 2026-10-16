import { NextResponse } from "next/server";
import { getAdminSession, hasPermission } from "@/lib/admin/auth";
import { getAllProductsAdmin, saveProductAdmin } from "@/lib/wearables/store";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const products = await getAllProductsAdmin();
  return NextResponse.json({ products });
}

export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Enforce granular RBAC: owner & admin allowed; editor & support prohibited from mutating wearables
  if (!hasPermission(session.role, "wearables", "write")) {
    return NextResponse.json(
      { error: "Forbidden: Role does not have write permission for wearables catalogue" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const result = await saveProductAdmin(body, session.id);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, errors: result.errors },
        { status: 400 }
      );
    }

    return NextResponse.json({ product: result.product });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
