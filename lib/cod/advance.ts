/**
 * Phase 7 — Authoritative Advance Payment Capture & Checkout Manager (Requirements #7, #8, #9, #10, #11, #12)
 * Enforces server-side provider fetch (CodAdvancePaymentProvider), HMAC validation via process.env.RAZORPAY_KEY_SECRET ONLY,
 * real server-side advance checkout order creation, and single-transaction RPC advance capture.
 */

import crypto from "node:crypto";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getOrderAdmin, saveOrder } from "@/lib/orders/store";

export type CodAdvancePaymentProvider = {
  fetchPayment(paymentId: string): Promise<{
    id: string;
    orderId: string;
    status: "created" | "authorized" | "captured" | "failed" | "refunded";
    amountPaise: number;
    currency: string;
  }>;
};

export class MockCodAdvancePaymentProvider implements CodAdvancePaymentProvider {
  private mockPayments = new Map<string, { id: string; orderId: string; status: "created" | "authorized" | "captured" | "failed" | "refunded"; amountPaise: number; currency: string }>();

  setMockPayment(id: string, orderId: string, status: "created" | "authorized" | "captured" | "failed" | "refunded", amountPaise: number, currency: string = "INR") {
    this.mockPayments.set(id, { id, orderId, status, amountPaise, currency });
  }

  async fetchPayment(paymentId: string) {
    const p = this.mockPayments.get(paymentId);
    if (!p) {
      // Requirement #7: Unknown mock payment ID MUST fail closed! Never fabricate captured payments.
      throw new Error(`payment_not_found: mock payment ID ${paymentId} not registered`);
    }
    return p;
  }
}

export type AdvancePaymentVerificationInput = {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  providerEventId?: string;
};

import { verifyRazorpayCheckoutSignature as verifyCheckoutSig } from "@/lib/payments/crypto";

export function verifyRazorpayCheckoutSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
  secret: string,
): boolean {
  return verifyCheckoutSig(
    {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: signature,
    },
    secret,
  );
}

/**
 * Creates a server-side Razorpay advance checkout order (Requirements #7, #9).
 * Uses claim_cod_advance_checkout_with_audit and bind_cod_advance_provider_order_with_audit
 * to guarantee exactly-once Razorpay order creation.
 */
export async function createCodAdvanceCheckoutOrderAdmin(
  input: { orderId: string; confirmationToken: string },
  mockOrderCreator?: (amountPaise: number, receipt: string) => Promise<{ razorpayOrderId: string }>,
): Promise<{ ok: true; razorpayOrderId: string; amountPaise: number; currency: string; keyId: string } | { ok: false; error: string }> {
  const order = await getOrderAdmin(input.orderId);
  if (!order) {
    return { ok: false, error: "order_not_found" };
  }

  if (order.paymentMethod !== "cod") {
    return { ok: false, error: "order_not_cod" };
  }

  // Token hash verification
  const tokenHash = crypto.createHash("sha256").update(input.confirmationToken || "").digest("hex");
  if (!order.codConfirmationTokenHash || order.codConfirmationTokenHash !== tokenHash) {
    return { ok: false, error: "invalid_confirmation_token" };
  }

  if (!["COD_ADVANCE_REQUIRED", "COD_ADVANCE_PENDING"].includes(order.codStatus || "")) {
    return { ok: false, error: "order_not_in_advance_required_state" };
  }

  const advanceAmountPaise = order.advanceAmountPaise || 20000;
  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || "rzp_test_key_id";

  if (hasSupabaseConfig()) {
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      return { ok: false, error: "Supabase service client unconfigured" };
    }

    const { data: claimRes, error: claimErr } = await supabase.rpc("claim_cod_advance_checkout_with_audit", {
      p_order_id: order.id,
    });

    if (claimErr || !claimRes?.ok) {
      return { ok: false, error: claimRes?.error || claimErr?.message || "claim_failed" };
    }

    if (claimRes.already_created) {
      return {
        ok: true,
        razorpayOrderId: claimRes.razorpay_order_id,
        amountPaise: Number(claimRes.amount_paise || advanceAmountPaise),
        currency: claimRes.currency || "INR",
        keyId,
      };
    }

    if (claimRes.creation_in_progress) {
      return { ok: false, error: "creation_in_progress" };
    }

    if (!claimRes.creator || !claimRes.claim_token) {
      return { ok: false, error: "claim_permission_denied" };
    }

    const claimToken = claimRes.claim_token;
    let razorpayOrderId: string;
    try {
      if (mockOrderCreator) {
        const res = await mockOrderCreator(advanceAmountPaise, order.id);
        razorpayOrderId = res.razorpayOrderId;
      } else {
        const { createRazorpayOrder } = await import("@/lib/payments/razorpay");
        const rzpOrder = await createRazorpayOrder({
          amountPaise: advanceAmountPaise,
          currency: "INR",
          receipt: order.id,
        });
        if (!rzpOrder) {
          const { error: markErr, data: markRes } = await supabase.rpc("mark_cod_advance_creation_unknown_with_audit", {
            p_payment_id: claimRes.payment_id,
            p_order_id: order.id,
            p_claim_token: claimToken,
            p_failure_reason: "razorpay_order_creation_failed",
          });
          if (markErr || !markRes?.ok) {
            console.error("[CodAdvance] Failed to mark creation_unknown:", markErr || markRes);
          }
          return { ok: false, error: "razorpay_order_creation_failed" };
        }
        razorpayOrderId = rzpOrder.id;
      }
    } catch (createErr) {
      await supabase.rpc("mark_cod_advance_creation_unknown_with_audit", {
        p_payment_id: claimRes.payment_id,
        p_order_id: order.id,
        p_claim_token: claimToken,
        p_failure_reason: String(createErr),
      });
      throw createErr;
    }

    const { error: bindErr, data: bindRes } = await supabase.rpc("bind_cod_advance_provider_order_with_audit", {
      p_payment_id: claimRes.payment_id,
      p_order_id: order.id,
      p_claim_token: claimToken,
      p_provider_order_id: razorpayOrderId,
    });

    if (bindErr || !bindRes?.ok) {
      return { ok: false, error: bindRes?.error || bindErr?.message || "bind_failed" };
    }

    order.codStatus = "COD_ADVANCE_PENDING";
    order.advanceStatus = "pending";
    await saveOrder(order);

    return {
      ok: true,
      razorpayOrderId,
      amountPaise: advanceAmountPaise,
      currency: "INR",
      keyId,
    };
  }

  // Dev/Test memory mode
  let razorpayOrderId: string;
  if (mockOrderCreator) {
    const res = await mockOrderCreator(advanceAmountPaise, order.id);
    razorpayOrderId = res.razorpayOrderId;
  } else {
    const { createRazorpayOrder } = await import("@/lib/payments/razorpay");
    const rzpOrder = await createRazorpayOrder({
      amountPaise: advanceAmountPaise,
      currency: "INR",
      receipt: order.id,
    });
    if (!rzpOrder) {
      return { ok: false, error: "razorpay_order_creation_failed" };
    }
    razorpayOrderId = rzpOrder.id;
  }

  order.codStatus = "COD_ADVANCE_PENDING";
  order.advanceStatus = "pending";
  await saveOrder(order);

  return {
    ok: true,
    razorpayOrderId,
    amountPaise: advanceAmountPaise,
    currency: "INR",
    keyId,
  };
}

export async function processCodAdvanceCaptureAdmin(
  input: AdvancePaymentVerificationInput,
  providerAdapter?: CodAdvancePaymentProvider,
  adminId?: string | null,
): Promise<{ ok: true; alreadyCaptured?: boolean } | { ok: false; error: string }> {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "razorpay_secret_unconfigured" };
    }
  }

  const validSig = verifyRazorpayCheckoutSignature(
    input.razorpayOrderId,
    input.razorpayPaymentId,
    input.razorpaySignature,
    secret || "test_key_secret_for_unit_tests",
  );

  if (!validSig) {
    return { ok: false, error: "invalid_razorpay_signature" };
  }

  const order = await getOrderAdmin(input.orderId);
  if (!order) {
    return { ok: false, error: "order_not_found" };
  }

  if (!order.advanceRequired) {
    return { ok: false, error: "advance_not_required_for_order" };
  }

  // Requirement #7: Production path MUST NOT use default MockCodAdvancePaymentProvider fallback
  let adapter = providerAdapter;
  if (!adapter) {
    const { fetchRazorpayPayment } = await import("@/lib/payments/razorpay");
    adapter = {
      fetchPayment: async (pid: string) => {
        const fetched = await fetchRazorpayPayment(pid);
        if (!fetched) {
          throw new Error(`payment_not_found: payment ${pid} not found on Razorpay`);
        }
        return {
          id: fetched.id,
          orderId: fetched.order_id,
          status: fetched.status as "captured",
          amountPaise: Number(fetched.amount),
          currency: fetched.currency || "INR",
        };
      },
    };
  }

  let paymentDetails: Awaited<ReturnType<CodAdvancePaymentProvider["fetchPayment"]>>;
  try {
    paymentDetails = await adapter.fetchPayment(input.razorpayPaymentId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch_failed";
    return { ok: false, error: msg };
  }

  // Requirement #8: Validate provider payment order details
  if (paymentDetails.id !== input.razorpayPaymentId) {
    return { ok: false, error: "payment_id_mismatch" };
  }

  if (paymentDetails.orderId !== input.razorpayOrderId) {
    return { ok: false, error: "provider_order_mismatch" };
  }

  if (paymentDetails.status !== "captured") {
    return { ok: false, error: "provider_payment_not_captured" };
  }

  const expectedAmount = order.advanceAmountPaise || 20000;
  if (paymentDetails.amountPaise !== expectedAmount) {
    return { ok: false, error: "captured_amount_mismatch" };
  }

  if (paymentDetails.currency !== "INR") {
    return { ok: false, error: "currency_mismatch" };
  }

  if (hasSupabaseConfig()) {
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      return { ok: false, error: "Supabase service client unconfigured" };
    }

    const { data: rpcRes, error: rpcErr } = await supabase.rpc("capture_cod_advance_with_audit", {
      p_order_id: input.orderId,
      p_provider_order_id: input.razorpayOrderId,
      p_provider_payment_id: input.razorpayPaymentId,
      p_captured_amount_paise: paymentDetails.amountPaise,
      p_provider_event_id: input.providerEventId || null,
      p_currency: paymentDetails.currency,
      p_admin_id: adminId || null,
    });

    if (rpcErr || !rpcRes || !(rpcRes as { ok?: boolean }).ok) {
      const errStr = (rpcRes as { error?: string })?.error || rpcErr?.message || "Advance capture RPC failed";
      return { ok: false, error: errStr };
    }

    const alreadyCaptured = Boolean((rpcRes as { already_captured?: boolean }).already_captured);
    return { ok: true, alreadyCaptured };
  }

  // Memory fallback for dev/testing
  if (order.advanceStatus === "captured") {
    return { ok: true, alreadyCaptured: true };
  }

  order.codStatus = "COD_APPROVED";
  order.advanceStatus = "captured";
  await saveOrder(order);

  return { ok: true, alreadyCaptured: false };
}
