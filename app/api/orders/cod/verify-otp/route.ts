import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getOrderAdmin } from "@/lib/orders/store";
import { verifyOtpChallengeAndApplyDecisionAdmin } from "@/lib/cod/otp";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, confirmationToken, otp } = body;

    if (!orderId || !confirmationToken || !otp) {
      return NextResponse.json(
        { ok: false, error: "Missing orderId, confirmationToken, or otp" },
        { status: 400 },
      );
    }

    const order = await getOrderAdmin(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    if (!order.codConfirmationTokenHash) {
      return NextResponse.json(
        { ok: false, error: "Order missing confirmation token hash" },
        { status: 400 },
      );
    }

    const tokenHash = crypto.createHash("sha256").update(confirmationToken).digest("hex");
    if (
      !crypto.timingSafeEqual(
        Buffer.from(tokenHash),
        Buffer.from(order.codConfirmationTokenHash),
      )
    ) {
      return NextResponse.json({ ok: false, error: "Invalid confirmation token" }, { status: 403 });
    }

    const verifyRes = await verifyOtpChallengeAndApplyDecisionAdmin(orderId, tokenHash, otp);

    if (!verifyRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: verifyRes.error,
          remainingAttempts: verifyRes.remainingAttempts,
        },
        { status: 400 },
      );
    }

    const updatedOrder = await getOrderAdmin(orderId);
    if (!updatedOrder) {
      return NextResponse.json({ ok: false, error: "Order not found after verification" }, { status: 500 });
    }

    // Sanitize customer response DTO (Requirement #27: NEVER expose token hash)
    const { codConfirmationTokenHash, ...sanitizedOrder } = updatedOrder;

    return NextResponse.json({
      ok: true,
      order: sanitizedOrder,
      targetStatus: verifyRes.targetStatus,
      advanceRequired: verifyRes.advanceRequired,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
