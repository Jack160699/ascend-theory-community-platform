import { NextResponse } from "next/server";
import { handleRazorpayWebhook } from "@/lib/payments/razorpay";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature");
    const eventId = request.headers.get("x-razorpay-event-id");

    const result = await handleRazorpayWebhook(rawBody, signature, eventId);
    if (!result.ok) {
      const status = ("status" in result && typeof result.status === "number") ? result.status : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/webhooks/razorpay] Webhook handling error:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
