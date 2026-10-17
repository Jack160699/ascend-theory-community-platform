import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getOrderAdmin } from "@/lib/orders/store";
import { createOtpChallengeAdmin } from "@/lib/cod/otp";

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

    // Fail-closed confirmation token binding check (Requirement #10)
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

    const rawPhone = order.customer?.phone || "";
    const result = await createOtpChallengeAdmin(orderId, rawPhone, tokenHash);

    if (!result.ok) {
      const isDeliveryFail = result.error.includes("otp_transport_delivery_failed");
      return NextResponse.json(
        { ok: false, error: result.error, details: "Transport failed to deliver OTP" },
        { status: isDeliveryFail ? 502 : 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      challengeId: result.challengeId,
      message: "OTP sent successfully",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
