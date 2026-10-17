import { getOrder } from "@/lib/orders/store";
import { NextResponse } from "next/server";
import crypto from "node:crypto";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { orderId } = await context.params;
  const order = await getOrder(orderId);

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const authHeader = request.headers.get("authorization");
  const readHeader = request.headers.get("x-ascend-customer-read-token");
  const confHeader = request.headers.get("x-ascend-confirmation-token");
  let token = readHeader || confHeader || "";
  if (!token && authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }

  if (!token) {
    return NextResponse.json({ error: "Forbidden: Customer read capability token missing" }, { status: 403 });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const matchesCodHash = Boolean(order.codConfirmationTokenHash && order.codConfirmationTokenHash === tokenHash);
  const matchesReadHash = Boolean(order.customerReadTokenHash && order.customerReadTokenHash === tokenHash);

  if (!matchesCodHash && !matchesReadHash) {
    return NextResponse.json({ error: "Forbidden: Invalid customer read capability token" }, { status: 403 });
  }

  const {
    codConfirmationTokenHash: _h,
    customerReadTokenHash: _rh,
    ...sanitizedOrder
  } = order;

  const sanitizedItems = (sanitizedOrder.items || []).map((item) => {
    const { manufacturingSnapshotJson: _s, manufacturingIdentityHash: _mh, ...sanitizedItem } = item;
    return sanitizedItem;
  });

  return NextResponse.json({
    order: {
      ...sanitizedOrder,
      items: sanitizedItems,
    },
  });
}
