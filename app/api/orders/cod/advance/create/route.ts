import { NextRequest, NextResponse } from "next/server";
import { getOrderAdmin } from "@/lib/orders/store";
import { createCodAdvanceCheckoutOrderAdmin } from "@/lib/cod/advance";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, confirmationToken } = body;

    if (!orderId || !confirmationToken) {
      return NextResponse.json(
        { ok: false, error: "Missing orderId or confirmationToken" },
        { status: 400 },
      );
    }

    const order = await getOrderAdmin(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    // Customer cannot supply amount/currency (Requirement #13)
    const result = await createCodAdvanceCheckoutOrderAdmin({ orderId, confirmationToken });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      razorpayOrderId: result.razorpayOrderId,
      amountPaise: result.amountPaise,
      currency: result.currency,
      keyId: result.keyId,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
