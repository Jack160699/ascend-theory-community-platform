import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/auth";
import {
  getAllFulfillmentsAdmin,
  createOrClaimFulfillmentAdmin,
  submitFulfillmentToProviderAdmin,
  retryFulfillmentSubmissionAdmin,
  reconcileSubmissionAdmin,
  updateFulfillmentStatusAdmin,
  toSupportDTO,
} from "@/lib/fulfillment/fulfillment-store";
import { evaluateOrderFulfillmentEligibility } from "@/lib/fulfillment/eligibility";

import { QIKINK_API_CONTRACT_VERIFIED } from "@/lib/fulfillment/qikink";

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized operational access" }, { status: 401 });
  }

  // Requirement #5: GET RBAC lockdown (owner, admin, support ONLY - block editor with 403)
  if (!["owner", "admin", "support"].includes(session.role)) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: Operational role permissions insufficient for fulfillment read access" },
      { status: 403 },
    );
  }

  const fulfillmentEnabled = process.env.QIKINK_FULFILLMENT_ENABLED === "true";
  const apiContractVerified = QIKINK_API_CONTRACT_VERIFIED;

  const safetyStatus = {
    transportLocked: !fulfillmentEnabled || !apiContractVerified,
    apiContractUnverified: !apiContractVerified,
  };

  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId");

  if (orderId) {
    // Requirement #7: Eligibility diagnostics restricted to owner and admin ONLY
    if (!["owner", "admin"].includes(session.role)) {
      return NextResponse.json(
        { ok: false, error: "Forbidden: Eligibility diagnostics require owner or admin permissions" },
        { status: 403 },
      );
    }
    const eligibility = await evaluateOrderFulfillmentEligibility(orderId);
    return NextResponse.json({ ok: true, eligibility, safetyStatus });
  }

  try {
    const fulfillments = await getAllFulfillmentsAdmin();
    // Requirement #6: Support-Safe DTO for support role
    if (session.role === "support") {
      return NextResponse.json({ ok: true, fulfillments: fulfillments.map(toSupportDTO), safetyStatus });
    }
    return NextResponse.json({ ok: true, fulfillments, safetyStatus });
  } catch (err) {
    // Fail closed on DB read failure
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load fulfillments", safetyStatus },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized operational access" }, { status: 401 });
  }

  // RBAC Requirement #5: Owner and Admin roles ONLY for manufacturing mutations
  if (!["owner", "admin"].includes(session.role)) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: Operational role permissions insufficient for manufacturing submission" },
      { status: 403 },
    );
  }

  const fulfillmentEnabled = process.env.QIKINK_FULFILLMENT_ENABLED === "true";
  const apiContractVerified = QIKINK_API_CONTRACT_VERIFIED;
  const isTransportLocked = !fulfillmentEnabled || !apiContractVerified;

  const adminId = session.id || null;

  try {
    const body = await req.json();
    const { action, orderId, fulfillmentId, status } = body;

    // Requirement #3: Block real claim & retry submission before transport lock
    if (action === "claim_and_submit" || action === "retry_submission") {
      if (isTransportLocked) {
        return NextResponse.json({ ok: false, error: "QIKINK_TRANSPORT_LOCKED" }, { status: 400 });
      }
    }

    if (action === "claim_and_submit" && orderId) {
      const claimRes = await createOrClaimFulfillmentAdmin(orderId, adminId);
      if (!claimRes.ok) {
        return NextResponse.json({ ok: false, error: claimRes.error, fulfillmentId: claimRes.fulfillmentId }, { status: 400 });
      }

      const submitRes = await submitFulfillmentToProviderAdmin(claimRes.fulfillment.id, adminId);
      if (!submitRes.ok) {
        return NextResponse.json({ ok: false, error: submitRes.error, fulfillment: submitRes.fulfillment }, { status: 400 });
      }

      return NextResponse.json({ ok: true, fulfillment: submitRes.fulfillment });
    }

    if (action === "retry_submission" && fulfillmentId) {
      const submitRes = await retryFulfillmentSubmissionAdmin(fulfillmentId, adminId);
      if (!submitRes.ok) {
        return NextResponse.json({ ok: false, error: submitRes.error, fulfillment: submitRes.fulfillment }, { status: 400 });
      }
      return NextResponse.json({ ok: true, fulfillment: submitRes.fulfillment });
    }

    if (action === "reconcile_submission" && fulfillmentId) {
      const reconcileRes = await reconcileSubmissionAdmin(fulfillmentId, adminId);
      if (!reconcileRes.ok) {
        return NextResponse.json({ ok: false, error: reconcileRes.error, fulfillment: reconcileRes.fulfillment }, { status: 400 });
      }
      return NextResponse.json({ ok: true, fulfillment: reconcileRes.fulfillment });
    }

    if (action === "update_status" && fulfillmentId && status) {
      const updateRes = await updateFulfillmentStatusAdmin(fulfillmentId, status, undefined, undefined, undefined, undefined, undefined, adminId);
      if (!updateRes.ok) {
        return NextResponse.json({ ok: false, error: updateRes.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Invalid action or parameters" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Internal server error" }, { status: 500 });
  }
}
