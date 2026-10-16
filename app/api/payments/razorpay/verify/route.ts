import { NextResponse } from "next/server";
import { verifyRazorpayCheckoutCallback } from "@/lib/payments/razorpay";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      ascendOrderId?: string;
      orderId?: string;
      razorpayOrderId?: string;
      razorpay_order_id?: string;
      razorpayPaymentId?: string;
      razorpay_payment_id?: string;
      razorpaySignature?: string;
      razorpay_signature?: string;
    };

    const ascendOrderId = body.ascendOrderId || body.orderId;
    const razorpayOrderId = body.razorpayOrderId || body.razorpay_order_id;
    const razorpayPaymentId = body.razorpayPaymentId || body.razorpay_payment_id;
    const razorpaySignature = body.razorpaySignature || body.razorpay_signature;

    if (!ascendOrderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return NextResponse.json(
        { error: "Missing required payment verification fields" },
        { status: 400 }
      );
    }

    const result = await verifyRazorpayCheckoutCallback({
      ascendOrderId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    }

    return NextResponse.json({ ok: true, orderId: ascendOrderId, alreadyPaid: result.alreadyPaid });
  } catch (err) {
    console.error("[api/payments/razorpay/verify] Verification error:", err);
    return NextResponse.json({ error: "Payment verification failed" }, { status: 500 });
  }
}
