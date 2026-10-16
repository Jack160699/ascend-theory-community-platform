import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { updateOrder } from "@/lib/orders/store";
import { getAuthoritativeOrderDetails } from "@/lib/orders/supabase-store";

export type PaymentCaptureResult =
  | { ok: true; alreadyPaid: boolean; orderId: string; message?: string }
  | { ok: false; error: string; status?: number };

export type ProcessedEventCheckResult =
  | { ok: true; processed: boolean }
  | { ok: false; error: string; dbError?: boolean };

/**
 * Checks if a provider event ID has ALREADY been SUCCESSFULLY processed in payment_events table.
 * Distinguishes: processed (true), not processed (false), and database error.
 */
export async function hasProcessedProviderEvent(
  providerEventId: string
): Promise<ProcessedEventCheckResult> {
  if (!providerEventId) return { ok: true, processed: false };

  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) {
    const isProduction = process.env.NODE_ENV === "production";
    const hasConfig = hasSupabaseConfig();
    if (isProduction || hasConfig) {
      return { ok: false, error: "Supabase service client unconfigured", dbError: true };
    }
    return { ok: true, processed: false };
  }

  const { data, error } = await serviceClient
    .from("payment_events")
    .select("id, event_type")
    .eq("provider_event_id", providerEventId)
    .in("event_type", ["payment_captured", "payment_failed"])
    .maybeSingle();

  if (error) {
    console.error("[payment_events] Query error for provider_event_id:", error);
    return { ok: false, error: `Database error querying provider event: ${error.message}`, dbError: true };
  }

  return { ok: true, processed: Boolean(data) };
}

/**
 * Authoritatively processes a verified payment capture using database RPC.
 * Production mode FAIL CLOSED: missing service client or RPC errors throw explicit failures.
 */
export async function capturePaymentAuthoritatively(params: {
  ascendOrderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountPaise: number;
  currency: string;
  providerEventId?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
}): Promise<PaymentCaptureResult> {
  const {
    ascendOrderId,
    razorpayOrderId,
    razorpayPaymentId,
    amountPaise,
    currency,
    providerEventId,
    eventType = "payment_captured",
    payload = {},
  } = params;

  const isProduction = process.env.NODE_ENV === "production";
  const hasConfig = hasSupabaseConfig();
  const serviceClient = createSupabaseServiceClient();

  // Fail closed in production if Supabase service client is unconfigured
  if (!serviceClient && (isProduction || hasConfig)) {
    throw new Error("[PaymentCapture] Supabase service role client is unconfigured.");
  }

  // 1. Fetch authoritative order record
  const authResult = await getAuthoritativeOrderDetails(ascendOrderId);
  if (!authResult.ok) {
    if (authResult.dbError) {
      return { ok: false, error: authResult.error, status: 500 };
    }
    return { ok: false, error: "Order not found", status: 404 };
  }

  const order = authResult.data;

  // 2. TERMINAL STATE SAFETY: Refuse cancelled or refunded orders
  if (order.status === "cancelled") {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "terminal_state_rejected",
      details: { status: "cancelled" },
    });
    return { ok: false, error: "Cannot process payment for cancelled order", status: 400 };
  }

  if (order.status === "refunded" || order.paymentStatus === "refunded") {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "terminal_state_rejected",
      details: { status: "refunded" },
    });
    return { ok: false, error: "Cannot process payment for refunded order", status: 400 };
  }

  // 3. Authoritative Total & Currency Validation (using totalPaise!)
  const expectedPaise = order.totalPaise;
  if (expectedPaise !== amountPaise) {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "amount_mismatch",
      details: { expectedPaise, receivedPaise: amountPaise },
    });
    return { ok: false, error: "Amount mismatch", status: 400 };
  }

  if (order.currency.toUpperCase() !== currency.toUpperCase()) {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "currency_mismatch",
      details: { expectedCurrency: order.currency, receivedCurrency: currency },
    });
    return { ok: false, error: "Currency mismatch", status: 400 };
  }

  // 4. Supabase DB Execution (when serviceClient is available)
  // NO JS SHORT-CIRCUIT: Always invoke atomic RPC so DB checks payment identity & idempotency
  if (serviceClient) {
    const { data: rpcData, error: rpcError } = await serviceClient.rpc(
      "process_successful_payment",
      {
        p_order_id: ascendOrderId,
        p_provider_payment_id: razorpayPaymentId,
        p_provider_order_id: razorpayOrderId,
        p_amount_paise: amountPaise,
        p_currency: currency,
        p_provider_event_id: providerEventId ?? null,
        p_event_type: eventType,
        p_payload: payload,
      }
    );

    if (rpcError) {
      console.error("[PaymentCapture] Supabase RPC execution error:", rpcError);
      if (isProduction || hasConfig) {
        throw new Error(`Payment capture database RPC failed: ${rpcError.message}`);
      }
      return { ok: false, error: `RPC Error: ${rpcError.message}`, status: 500 };
    }

    if (!rpcData || typeof rpcData !== "object") {
      if (isProduction || hasConfig) {
        throw new Error("Payment capture RPC returned malformed null response");
      }
      return { ok: false, error: "RPC returned malformed response", status: 500 };
    }

    const resObj = rpcData as { ok?: boolean; error?: string; already_paid?: boolean };
    if (!resObj.ok) {
      const errMessage = resObj.error || "RPC returned error response";
      return { ok: false, error: errMessage, status: 400 };
    }

    return {
      ok: true,
      alreadyPaid: Boolean(resObj.already_paid),
      orderId: ascendOrderId,
    };
  }

  // Strict check: local fallback is ONLY permitted when serviceClient is null in dev/test without Supabase config
  if (isProduction || hasConfig) {
    throw new Error("[PaymentCapture] Cannot fall back to local memory store when Supabase is configured");
  }

  // Check in-memory status for dev/test mode without Supabase
  if (order.status === "paid") {
    if (order.paymentReference && order.paymentReference !== razorpayOrderId) {
      return { ok: false, error: "already_paid_conflict", status: 400 };
    }
    return { ok: true, alreadyPaid: true, orderId: ascendOrderId };
  }

  await updateOrder(ascendOrderId, {
    status: "paid",
    paymentReference: razorpayOrderId,
  });

  return { ok: true, alreadyPaid: false, orderId: ascendOrderId };
}

/**
 * Persists required payment event to database. Surfacing DB errors.
 */
export async function recordRequiredPaymentEvent(params: {
  orderId?: string;
  paymentId?: string;
  eventType: string;
  providerEventId?: string;
  details?: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) {
    const isProduction = process.env.NODE_ENV === "production";
    const hasConfig = hasSupabaseConfig();
    if (isProduction || hasConfig) {
      return { ok: false, error: "Supabase service client unconfigured" };
    }
    return { ok: true };
  }

  const sanitizedDetails = { ...(params.details || {}) };
  delete sanitizedDetails.signature;
  delete sanitizedDetails.razorpay_signature;
  delete sanitizedDetails.authorization;
  delete sanitizedDetails.secret;

  const { error } = await serviceClient.from("payment_events").insert({
    order_id: params.orderId ?? null,
    payment_id: params.paymentId ?? null,
    event_type: params.eventType,
    provider_event_id: params.providerEventId ?? null,
    payload_json: sanitizedDetails,
  });

  if (error) {
    console.error("[payment_events] Required event insert error:", error);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

/**
 * Persists best-effort audit event to database.
 * Does NOT log secrets or sensitive headers.
 */
export async function recordBestEffortPaymentEvent(params: {
  orderId?: string;
  paymentId?: string;
  eventType: string;
  providerEventId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await recordRequiredPaymentEvent(params);
}
