import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getOrderAdmin } from "@/lib/orders/store";
import { processCodAdvanceCaptureAdmin } from "@/lib/cod/advance";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, confirmationToken, razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;

    if (!orderId || !confirmationToken || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
    }

    const order = await getOrderAdmin(orderId);
    if (!order) {
      return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    }

    // Token binding verification
    const tokenHash = crypto.createHash("sha256").update(confirmationToken).digest("hex");
    if (!order.codConfirmationTokenHash || order.codConfirmationTokenHash !== tokenHash) {
      return NextResponse.json({ error: "invalid_confirmation_token" }, { status: 403 });
    }

    const res = await processCodAdvanceCaptureAdmin({
      orderId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, codStatus: "COD_APPROVED", alreadyCaptured: Boolean(res.alreadyCaptured) });
  } catch (err) {
    console.error("[api/orders/cod/advance/verify]", err);
    return NextResponse.json({ error: "internal_server_error" }, { status: 500 });
  }
}
