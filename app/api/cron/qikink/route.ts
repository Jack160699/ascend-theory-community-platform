import { NextRequest, NextResponse } from "next/server";
import { sweepEligibleOrders, syncOpenFulfillments } from "@/lib/fulfillment/qikink-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron: sends any eligible orders that missed their trigger, then refreshes Qikink status/AWB. */
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret) return auth === `Bearer ${secret}`;
  return (req.headers.get("user-agent") || "").startsWith("vercel-cron/");
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  const sweep = await sweepEligibleOrders();
  const synced = await syncOpenFulfillments();
  return NextResponse.json({ ok: true, sweep, synced });
}
