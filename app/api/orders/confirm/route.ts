import { getOrder } from "@/lib/orders/store";
import { NextResponse } from "next/server";

/**
 * Read-only order status retrieval endpoint.
 * Unauthenticated orderId confirmation without cryptographic payment proof has been REMOVED.
 */
export async function POST(request: Request) {
  try {
    const { orderId } = (await request.json()) as { orderId?: string };
    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId." }, { status: 400 });
    }

    const order = await getOrder(orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    // Returns authoritative order state without mutating order status
    return NextResponse.json({ order });
  } catch (err) {
    console.error("[api/orders/confirm]", err);
    return NextResponse.json({ error: "Order retrieval failed." }, { status: 500 });
  }
}
