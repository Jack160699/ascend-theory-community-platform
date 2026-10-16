import { createOrder } from "@/lib/orders/create-order";
import type { CreateOrderInput } from "@/lib/orders/types";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateOrderInput;

    if (!body?.items?.length || !body?.customer) {
      return NextResponse.json(
        { error: "Invalid order payload." },
        { status: 400 },
      );
    }

    const origin =
      request.headers.get("origin") ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      "http://localhost:3000";

    const result = await createOrder(body, origin);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      order: result.data.order,
      confirmationToken: result.data.confirmationToken ?? undefined,
      customerReadToken: result.data.customerReadToken ?? undefined,
      paymentUrl: result.data.paymentUrl ?? null,
    });
  } catch (err) {
    console.error("[api/create-order]", err);
    return NextResponse.json(
      { error: "Unable to create order. Please try again." },
      { status: 500 },
    );
  }
}
