-- =============================================================================
-- ASCEND THEORY PLATFORM — ADDITIVE MIGRATION (PHASE 3 PAYMENTS HARDENING PATCH)
-- Migration: 20260809000003_secure_payments_and_idempotency.sql
-- Description: Aligns payments & payment_events tables with Phase 2 schema.
--              Adds provider_order_id, provider_payment_id, captured_at.
--              Creates atomic SECURITY DEFINER process_successful_payment RPC
--              strictly granted to service_role ONLY.
--              Requires provider='razorpay' initial payment mapping.
--              Persists provider_event_id ONLY on terminal success.
--              Handles callback-first -> webhook-later event registration.
-- =============================================================================

-- 1. Additive columns for payments table
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Additive columns & constraints for payment_events table
ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_event_id TEXT;

-- Make payment_id nullable in payment_events for pre-payment / security audit logging
ALTER TABLE public.payment_events
  ALTER COLUMN payment_id DROP NOT NULL;

-- 3. Idempotency Unique Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_order_id_unique
  ON public.payments (provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment_id_unique
  ON public.payments (provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_provider_event_id_unique
  ON public.payment_events (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_order_id ON public.payment_events (order_id);

-- 4. SECURITY DEFINER Atomic Payment Processing RPC
CREATE OR REPLACE FUNCTION public.process_successful_payment(
  p_order_id TEXT,
  p_provider_payment_id TEXT,
  p_provider_order_id TEXT,
  p_amount_paise BIGINT,
  p_currency TEXT,
  p_provider_event_id TEXT DEFAULT NULL,
  p_event_type TEXT DEFAULT 'payment_captured',
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_payment RECORD;
  v_other_payment RECORD;
  v_expected_paise BIGINT;
BEGIN
  -- 1. Lock target order
  SELECT id, status, payment_status, total_paise, subtotal_paise, currency
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  -- 2. TERMINAL STATE SAFETY: Refuse cancelled or refunded orders
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_cancelled');
  END IF;
  IF v_order.status = 'refunded' OR v_order.payment_status = 'refunded' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_refunded');
  END IF;

  -- 3. Require existing payment mapping created during checkout (explicitly provider = 'razorpay')
  SELECT id, order_id, provider_order_id, provider_payment_id, amount_paise, currency, status
  INTO v_payment
  FROM public.payments
  WHERE provider_order_id = p_provider_order_id
    AND order_id = p_order_id
    AND provider = 'razorpay'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Check if provider_order_id belongs to another order
    SELECT id, order_id INTO v_other_payment
    FROM public.payments
    WHERE provider_order_id = p_provider_order_id
    LIMIT 1;

    IF v_other_payment IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'provider_order_rebound');
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'payment_mapping_missing');
    END IF;
  END IF;

  -- 4. Reject if provider_payment_id is attached to a DIFFERENT order
  SELECT id INTO v_other_payment
  FROM public.payments
  WHERE provider_payment_id = p_provider_payment_id
    AND order_id != p_order_id
  LIMIT 1;

  IF v_other_payment IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_payment_rebound');
  END IF;

  -- 5. Currency & Authoritative Amount Validation
  -- Audit events for mismatches do NOT pass provider_event_id (passed as NULL) so event ID is preserved for retries
  IF UPPER(v_order.currency) != UPPER(p_currency) THEN
    INSERT INTO public.payment_events (order_id, event_type, provider_event_id, payload_json)
    VALUES (p_order_id, 'currency_mismatch', NULL, jsonb_build_object(
      'expected_currency', v_order.currency,
      'received_currency', p_currency
    ));
    RETURN jsonb_build_object('ok', false, 'error', 'currency_mismatch');
  END IF;

  v_expected_paise := COALESCE(NULLIF(v_order.total_paise, 0), v_order.subtotal_paise);
  IF v_expected_paise != p_amount_paise THEN
    INSERT INTO public.payment_events (order_id, event_type, provider_event_id, payload_json)
    VALUES (p_order_id, 'amount_mismatch', NULL, jsonb_build_object(
      'expected_total_paise', v_expected_paise,
      'received_amount_paise', p_amount_paise
    ));
    RETURN jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  END IF;

  -- 6. Already Paid Check (Callback-First -> Webhook-Later Idempotency)
  IF v_order.status = 'paid' OR v_order.payment_status = 'captured' OR v_payment.status = 'captured' THEN
    IF v_payment.provider_payment_id = p_provider_payment_id THEN
      -- If webhook arrives later with p_provider_event_id, register payment_captured event with provider_event_id
      IF p_provider_event_id IS NOT NULL THEN
        INSERT INTO public.payment_events (
          order_id,
          payment_id,
          event_type,
          provider_event_id,
          payload_json
        )
        VALUES (
          p_order_id,
          v_payment.id,
          'payment_captured',
          p_provider_event_id,
          p_payload
        )
        ON CONFLICT (provider_event_id) WHERE provider_event_id IS NOT NULL
        DO NOTHING;
      END IF;

      RETURN jsonb_build_object(
        'ok', true,
        'order_id', p_order_id,
        'already_paid', true,
        'payment_status', 'captured'
      );
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'already_paid_conflict');
    END IF;
  END IF;

  -- 7. Update exact payment record & order status
  UPDATE public.payments
  SET
    provider_payment_id = p_provider_payment_id,
    gateway_transaction_id = p_provider_payment_id,
    status = 'captured',
    captured_at = COALESCE(captured_at, now()),
    updated_at = now()
  WHERE id = v_payment.id;

  UPDATE public.orders
  SET
    status = 'paid',
    payment_status = 'captured',
    updated_at = now()
  WHERE id = p_order_id;

  -- 8. Record terminal success payment audit event
  IF p_provider_event_id IS NOT NULL THEN
    INSERT INTO public.payment_events (
      order_id,
      payment_id,
      event_type,
      provider_event_id,
      payload_json
    )
    VALUES (
      p_order_id,
      v_payment.id,
      p_event_type,
      p_provider_event_id,
      p_payload
    )
    ON CONFLICT (provider_event_id) WHERE provider_event_id IS NOT NULL
    DO NOTHING;
  ELSE
    INSERT INTO public.payment_events (
      order_id,
      payment_id,
      event_type,
      payload_json
    )
    VALUES (
      p_order_id,
      v_payment.id,
      p_event_type,
      p_payload
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'already_paid', false,
    'payment_status', 'captured'
  );
END;
$$;

-- 5. Strict RPC Privilege Lockdown: Revoke from PUBLIC, anon, authenticated; Grant ONLY to service_role
REVOKE ALL ON FUNCTION public.process_successful_payment(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_successful_payment(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.process_successful_payment(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_successful_payment(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, JSONB) TO service_role;
