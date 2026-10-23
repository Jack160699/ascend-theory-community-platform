import { NextResponse, type NextRequest } from "next/server";
import { setProductPrice } from "@/lib/studio/publish";
import { errorResponse, requireStudioAdmin } from "@/lib/studio/server";

/** One price for a product and every colour/size. */
export async function POST(req: NextRequest) {
  const guard = await requireStudioAdmin();
  if (!guard.ok) return guard.response;
  try {
    const { productId, price, currency } = (await req.json()) as { productId?: string; price?: number; currency?: "INR" | "USD" };
    if (!productId) throw new Error("Which product?");
    await setProductPrice(productId, Number(price), currency ?? "INR");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
