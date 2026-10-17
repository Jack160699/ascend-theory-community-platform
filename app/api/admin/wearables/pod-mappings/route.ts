import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireRole } from "@/lib/admin/auth";
import {
  getAllPODProvidersAdmin,
  getAllProviderMappingsAdmin,
  saveProviderMappingAdmin,
} from "@/lib/wearables/design-store";

export async function GET() {
  try {
    await requireAdmin();
    const [providers, mappings] = await Promise.all([
      getAllPODProvidersAdmin(),
      getAllProviderMappingsAdmin(),
    ]);

    return NextResponse.json({
      ok: true,
      providers,
      providerProducts: mappings.providerProducts,
      providerVariants: mappings.providerVariants,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("Unauthorized") ? 401 : 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireRole("admin");
    const body = await req.json();

    const result = await saveProviderMappingAdmin(
      {
        providerProduct: body.providerProduct || body,
        providerVariants: body.providerVariants || [],
      },
      profile.id
    );

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, providerProduct: result.providerProduct });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("Unauthorized") ? 401 : 500 });
  }
}
