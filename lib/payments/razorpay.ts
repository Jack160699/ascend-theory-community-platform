import type { Order } from "@/lib/orders/types";
import { getAuthoritativeOrderDetails } from "@/lib/orders/supabase-store";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import {
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
} from "./crypto";
import {
  capturePaymentAuthoritatively,
  hasProcessedProviderEvent,
  recordBestEffortPaymentEvent,
  recordRequiredPaymentEvent,
} from "./store-payments";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export function getRazorpayKeyId(): string | null {
  return (
    process.env.RAZORPAY_KEY_ID ||
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ||
    null
  );
}

export function getRazorpayKeySecret(): string | null {
  return process.env.RAZORPAY_KEY_SECRET || null;
}

export function getRazorpayWebhookSecret(): string | null {
  return process.env.RAZORPAY_WEBHOOK_SECRET || null;
}

export function isRazorpayEnabled(): boolean {
  return Boolean(getRazorpayKeyId() && getRazorpayKeySecret());
}

function getAuthHeader(): string | null {
  const keyId = getRazorpayKeyId();
  const keySecret = getRazorpayKeySecret();
  if (!keyId || !keySecret) return null;
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

export type RazorpayCheckoutResult = {
  orderId: string;
  razorpayKeyId: string;
  amountPaise: number;
  currency: string;
  paymentUrl: string;
};

export type RazorpayProviderPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
};

export type PaymentMappingResult =
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false; error: string; dbError: true };

/**
 * Server-side REST API fetch to retrieve payment details directly from Razorpay.
 */
export async function fetchRazorpayPayment(
  paymentId: string
): Promise<RazorpayProviderPayment | null> {
  const auth = getAuthHeader();
  if (!auth) return null;

  try {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      method: "GET",
      headers: { Authorization: auth },
    });

    if (!res.ok) return null;
    return (await res.json()) as RazorpayProviderPayment;
  } catch {
    return null;
  }
}

/**
 * Server-side REST API call to capture an authorized Razorpay payment.
 */
export async function captureRazorpayPayment(
  paymentId: string,
  amountPaise: number,
  currency: string
): Promise<RazorpayProviderPayment | null> {
  const auth = getAuthHeader();
  if (!auth) return null;

  try {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/capture`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: amountPaise, currency }),
    });

    if (!res.ok) return null;
    return (await res.json()) as RazorpayProviderPayment;
  } catch {
    return null;
  }
}

/**
 * Helper to fetch existing durable payment mapping from Supabase database.
 * Explicitly separates DB query errors (dbError) from missing mapping (data: null).
 */
export async function getRazorpayPaymentMappingForOrder(
  ascendOrderId: string,
  razorpayOrderId: string
): Promise<PaymentMappingResult> {
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) {
    const isProduction = process.env.NODE_ENV === "production";
    const hasConfig = hasSupabaseConfig();
    if (isProduction || hasConfig) {
      return { ok: false, error: "Supabase service client unconfigured", dbError: true };
    }
    return { ok: true, data: null };
  }

  const { data, error } = await serviceClient
    .from("payments")
    .select("id, order_id, provider, provider_order_id, provider_payment_id, amount_paise, currency, status")
    .eq("order_id", ascendOrderId)
    .eq("provider_order_id", razorpayOrderId)
    .eq("provider", "razorpay")
    .maybeSingle();

  if (error) {
    console.error("[payments] Query error for order payment mapping:", error);
    return { ok: false, error: `Database error querying payment mapping: ${error.message}`, dbError: true };
  }

  return { ok: true, data: data as Record<string, unknown> | null };
}

/**
 * Creates an authoritative server-side Razorpay order using DB orders.total_paise.
 * Fails closed in production mode if Razorpay credentials or DB lookup/persistence fails.
 */
export async function createRazorpayCheckout(
  order: Order,
  origin: string
): Promise<RazorpayCheckoutResult | null> {
  const isProduction = process.env.NODE_ENV === "production";
  const keyId = getRazorpayKeyId();
  const auth = getAuthHeader();

  if (!auth || !keyId) {
    if (isProduction) {
      throw new Error("Razorpay secret credentials missing in production mode.");
    }
    return null;
  }

  // Load Authoritative DB Total & Currency
  const authOrderRes = await getAuthoritativeOrderDetails(order.id);
  let amountPaise: number;
  let currency: string;

  if (authOrderRes.ok) {
    amountPaise = authOrderRes.data.totalPaise;
    currency = authOrderRes.data.currency.toUpperCase();
  } else {
    if (isProduction || hasSupabaseConfig()) {
      throw new Error(`Authoritative order lookup failed during checkout creation: ${authOrderRes.error}`);
    }
    amountPaise = Math.round(order.subtotal * 100);
    currency = (order.currency === "USD" ? "USD" : "INR").toUpperCase();
  }

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency,
      receipt: order.id,
      notes: {
        ascendOrderId: order.id,
        customerEmail: order.customer.email,
      },
    }),
  });

  if (!res.ok) {
    console.error("[razorpay] order create failed", await res.text());
    if (isProduction) {
      throw new Error("Razorpay order creation API failed.");
    }
    return null;
  }

  const data = (await res.json()) as { id: string };

  // Initial payment mapping is MANDATORY
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) {
    if (isProduction) {
      throw new Error("Supabase service client missing during checkout creation.");
    }
  } else {
    const { error: insertError } = await serviceClient.from("payments").insert({
      order_id: order.id,
      provider: "razorpay",
      provider_order_id: data.id,
      amount_paise: amountPaise,
      currency,
      status: "created",
    });

    if (insertError) {
      console.error("[razorpay] Initial payment record insert error:", insertError);
      if (isProduction) {
        throw new Error(`Failed to persist initial payment mapping: ${insertError.message}`);
      }
      return null;
    }
  }

  await recordBestEffortPaymentEvent({
    orderId: order.id,
    eventType: "razorpay_order_created",
    details: {
      razorpayOrderId: data.id,
      amountPaise,
      currency,
    },
  });

  const paymentUrl = `${origin}/checkout/confirmation?orderId=${encodeURIComponent(
    order.id
  )}&razorpay_order_id=${encodeURIComponent(data.id)}&razorpay_key=${encodeURIComponent(keyId)}`;

  return {
    orderId: data.id,
    razorpayKeyId: keyId,
    amountPaise,
    currency,
    paymentUrl,
  };
}

/**
 * Cryptographically verifies a server-side checkout callback and verifies Razorpay provider state before DB transition.
 * MANDATORY: Requires server Razorpay credentials and existing initial payment mapping.
 */
export async function verifyRazorpayCheckoutCallback(params: {
  ascendOrderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  const { ascendOrderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = params;

  // 1. Mandatory Razorpay Secret Credentials Check
  const keyId = getRazorpayKeyId();
  const keySecret = getRazorpayKeySecret();
  if (!keyId || !keySecret) {
    return { ok: false, error: "Razorpay secret credentials unconfigured", status: 500 };
  }

  // 2. Verify HMAC SHA-256 signature
  const isSignatureValid = verifyRazorpayCheckoutSignature({
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: razorpaySignature,
  });

  if (!isSignatureValid) {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "signature_invalid",
      details: { razorpayOrderId, razorpayPaymentId },
    });
    return { ok: false, error: "Invalid payment signature", status: 400 };
  }

  // 3. Fetch authoritative target Ascend Order details from DB or memory (FAILS CLOSED ON DB ERROR)
  const authOrderRes = await getAuthoritativeOrderDetails(ascendOrderId);
  if (!authOrderRes.ok) {
    if (authOrderRes.dbError) {
      return { ok: false, error: authOrderRes.error, status: 500 };
    }
    return { ok: false, error: "Order not found", status: 404 };
  }

  const orderCurrency = authOrderRes.data.currency;
  const expectedPaise = authOrderRes.data.totalPaise;

  // 4. Require Existing Durable Payment Mapping
  const serviceClient = createSupabaseServiceClient();
  if (serviceClient) {
    const mappingRes = await getRazorpayPaymentMappingForOrder(ascendOrderId, razorpayOrderId);
    if (!mappingRes.ok) {
      return { ok: false, error: mappingRes.error, status: 500 };
    }

    const existingMapping = mappingRes.data;
    if (!existingMapping) {
      await recordBestEffortPaymentEvent({
        orderId: ascendOrderId,
        eventType: "payment_mapping_missing",
        details: { razorpayOrderId },
      });
      return { ok: false, error: "Initial payment record missing for order", status: 400 };
    }

    if (existingMapping.order_id !== ascendOrderId) {
      return { ok: false, error: "Razorpay order ID belongs to a different Ascend order", status: 400 };
    }

    if (Number(existingMapping.amount_paise) !== expectedPaise) {
      return { ok: false, error: "Amount mismatch", status: 400 };
    }

    if (String(existingMapping.currency).toUpperCase() !== orderCurrency.toUpperCase()) {
      return { ok: false, error: "Currency mismatch", status: 400 };
    }
  }

  // 5. MANDATORY Provider REST API State Verification
  let providerPayment = await fetchRazorpayPayment(razorpayPaymentId);
  if (!providerPayment) {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "provider_fetch_failed",
      details: { razorpayPaymentId },
    });
    return { ok: false, error: "Failed to verify payment state with Razorpay API", status: 502 };
  }

  // Verify Provider Payment Attributes
  if (providerPayment.id !== razorpayPaymentId) {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "provider_payment_mismatch",
      details: { expected: razorpayPaymentId, received: providerPayment.id },
    });
    return { ok: false, error: "Razorpay payment ID mismatch", status: 400 };
  }

  if (providerPayment.order_id !== razorpayOrderId) {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "provider_order_mismatch",
      details: { expected: razorpayOrderId, received: providerPayment.order_id },
    });
    return { ok: false, error: "Razorpay payment belongs to another Razorpay order", status: 400 };
  }

  if (providerPayment.amount !== expectedPaise) {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "amount_mismatch",
      details: { expected: expectedPaise, received: providerPayment.amount },
    });
    return { ok: false, error: "Amount mismatch", status: 400 };
  }

  if (providerPayment.currency.toUpperCase() !== orderCurrency.toUpperCase()) {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "currency_mismatch",
      details: { expected: orderCurrency, received: providerPayment.currency },
    });
    return { ok: false, error: "Currency mismatch", status: 400 };
  }

  // Auto-capture if status is authorized
  if (providerPayment.status === "authorized") {
    const captured = await captureRazorpayPayment(razorpayPaymentId, expectedPaise, orderCurrency);
    if (captured) providerPayment = captured;
  }

  if (providerPayment.status !== "captured") {
    await recordBestEffortPaymentEvent({
      orderId: ascendOrderId,
      eventType: "payment_uncaptured",
      details: { providerStatus: providerPayment.status },
    });
    return {
      ok: false,
      error: `Payment is not in captured state (current status: ${providerPayment.status})`,
      status: 400,
    };
  }

  // 6. Authoritatively capture payment in database
  const captureResult = await capturePaymentAuthoritatively({
    ascendOrderId,
    razorpayOrderId,
    razorpayPaymentId,
    amountPaise: expectedPaise,
    currency: orderCurrency,
    eventType: "payment_captured",
    payload: { source: "checkout_callback" },
  });

  if (!captureResult.ok) {
    return { ok: false, error: captureResult.error, status: captureResult.status || 400 };
  }

  return { ok: true, alreadyPaid: captureResult.alreadyPaid, orderId: ascendOrderId };
}

/**
 * Handles incoming Razorpay Webhooks with HMAC signature verification & idempotency.
 * Does NOT pre-consume provider_event_id before successful RPC transaction.
 * Ignores order.paid safely; handles payment.captured as canonical capture event.
 */
export async function handleRazorpayWebhook(
  rawBody: string | Buffer,
  signatureHeader: string | null,
  eventIdHeader?: string | null
) {
  // 1. Verify HMAC SHA-256 Webhook signature
  const isValid = verifyRazorpayWebhookSignature(rawBody, signatureHeader);
  if (!isValid) {
    await recordBestEffortPaymentEvent({
      eventType: "signature_invalid",
      details: { source: "webhook" },
    });
    return { ok: false, error: "Invalid webhook signature", status: 400 };
  }

  // 2. Check for ALREADY SUCCESSFULLY PROCESSED event
  const providerEventId = eventIdHeader || undefined;
  if (providerEventId) {
    const checkRes = await hasProcessedProviderEvent(providerEventId);
    if (!checkRes.ok) {
      // Database query error during idempotency check -> fail closed (500) so Razorpay retries!
      return { ok: false, error: checkRes.error, status: 500 };
    }
    if (checkRes.processed) {
      return { ok: true, alreadyPaid: true, message: "Duplicate webhook event already processed" };
    }
  }

  // Log webhook_received WITHOUT consuming provider_event_id!
  await recordBestEffortPaymentEvent({
    eventType: "webhook_received",
    details: { event: "webhook_received" },
  });

  const bodyString = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(bodyString) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Invalid JSON body", status: 400 };
  }

  const event = payload.event as string;

  if (event === "order.paid") {
    return { ok: true, message: "order.paid ignored; payment.captured is canonical" };
  }

  const payloadContainer = payload.payload as
    | {
        payment?: { entity?: Record<string, unknown> };
      }
    | undefined;

  if (event === "payment.captured") {
    const entity = payloadContainer?.payment?.entity;
    if (!entity) {
      return { ok: true, message: "No payment entity payload to process" };
    }

    const razorpayOrderId = entity.order_id as string;
    const razorpayPaymentId = entity.id as string;
    const amountPaise = entity.amount as number;
    const currency = entity.currency as string;
    const notes = entity.notes as { ascendOrderId?: string } | undefined;
    const ascendOrderId = (notes?.ascendOrderId || entity.receipt) as string;

    if (!ascendOrderId || !razorpayOrderId || !razorpayPaymentId) {
      return { ok: true, message: "Missing required order/payment IDs in webhook entity" };
    }

    // Requirement #12: Check if provider_order_id belongs to a COD advance payment (Fail closed on DB error)
    if (hasSupabaseConfig()) {
      const supabase = createSupabaseServiceClient();
      if (supabase) {
        const { data: advRow, error: advErr } = await supabase
          .from("cod_advance_payments")
          .select("order_id, expected_amount_paise, currency")
          .eq("provider", "razorpay")
          .eq("provider_order_id", razorpayOrderId)
          .maybeSingle();

        if (advErr) {
          console.error("[Razorpay Webhook] DB error querying cod_advance_payments:", advErr);
          return { ok: false, error: `db_error_fetching_advance_payment: ${advErr.message}`, status: 500 };
        }

        if (advRow?.order_id) {
          const { error: rpcErr, data: rpcRes } = await supabase.rpc("capture_cod_advance_with_audit", {
            p_order_id: advRow.order_id,
            p_provider_order_id: razorpayOrderId,
            p_provider_payment_id: razorpayPaymentId,
            p_captured_amount_paise: amountPaise,
            p_provider_event_id: providerEventId || null,
            p_currency: currency || "INR",
          });

          if (rpcErr || (rpcRes && !rpcRes.ok)) {
            return { ok: false, error: rpcRes?.error || rpcErr?.message || "advance_capture_failed", status: 400 };
          }
          return { ok: true, message: "COD advance payment captured via webhook", alreadyCaptured: Boolean(rpcRes?.already_captured || rpcRes?.already_processed) };
        }
      }
    }

    // Atomic RPC executes and persists payment_captured event with provider_event_id AT TRANSACTION SUCCESS
    const captureResult = await capturePaymentAuthoritatively({
      ascendOrderId,
      razorpayOrderId,
      razorpayPaymentId,
      amountPaise,
      currency,
      providerEventId,
      eventType: "payment_captured",
      payload: { webhookEvent: event },
    });

    return captureResult;
  }

  if (event === "payment.failed") {
    const entity = payloadContainer?.payment?.entity;
    const notes = entity?.notes as { ascendOrderId?: string } | undefined;
    const ascendOrderId = (notes?.ascendOrderId || entity?.receipt) as string | undefined;

    if (ascendOrderId) {
      const logRes = await recordRequiredPaymentEvent({
        orderId: ascendOrderId,
        eventType: "payment_failed",
        providerEventId,
        details: {
          error_code: entity?.error_code,
          error_description: entity?.error_description,
        },
      });

      if (!logRes.ok) {
        return { ok: false, error: `Failed to persist payment_failed event: ${logRes.error}`, status: 500 };
      }
    }
    return { ok: true, message: "Payment failure recorded" };
  }

  return { ok: true, message: "Webhook event ignored" };
}

/**
 * Creates a standalone Razorpay order for COD advance payments.
 * Reuses existing auth helpers. Fails closed if Razorpay credentials are missing.
 */
export async function createRazorpayOrder(params: {
  amountPaise: number;
  currency: string;
  receipt: string;
}): Promise<{ id: string; amount: number; currency: string } | null> {
  const auth = getAuthHeader();
  if (!auth) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[razorpay] Cannot create order: credentials missing in production");
    }
    return null;
  }

  try {
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        currency: params.currency,
        receipt: params.receipt,
        notes: { purpose: "cod_advance", ascendOrderId: params.receipt },
      }),
    });

    if (!res.ok) {
      console.error("[razorpay] advance order create failed:", await res.text());
      return null;
    }

    const data = (await res.json()) as { id: string; amount: number; currency: string };
    return data;
  } catch (err) {
    console.error("[razorpay] advance order create error:", err);
    return null;
  }
}
