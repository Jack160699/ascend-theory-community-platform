import { NextResponse, after } from "next/server";
import { autoSubmitOrderToQikink } from "@/lib/fulfillment/qikink-sync";
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

    // Paid → send to Qikink once the response is out (eligibility re-checks payment).
    const paidOrderId = "orderId" in result && typeof result.orderId === "string" ? result.orderId : undefined;
    if (paidOrderId) after(() => autoSubmitOrderToQikink(paidOrderId).then(() => undefined));

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/webhooks/razorpay] Webhook handling error:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
