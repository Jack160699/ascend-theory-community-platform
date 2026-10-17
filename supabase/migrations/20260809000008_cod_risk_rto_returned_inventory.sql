-- =============================================================================
-- ASCEND THEORY PLATFORM — ADDITIVE MIGRATION (PHASE 7 COD RISK, RTO + RETURNED INVENTORY REPAIR)
-- Migration: 20260809000008_cod_risk_rto_returned_inventory.sql
-- Description: Alters existing Phase 2 tables (cod_risk_profiles, returned_inventory),
--              extends orders with cod_status & advance fields, creates cod_advance_payments,
--              cod_lifecycle_events, cod_otp_challenges, and delivery_outcome_events tables with RLS and privilege lockdown.
--              Adds transactional SECURITY DEFINER RPCs for COD decisions, OTP challenges,
--              advance captures, delivery outcomes, and atomic returned inventory reservations with row locking.
-- =============================================================================

-- 1. Search path hygiene repair for live Phase 6 helper function
ALTER FUNCTION public.is_valid_fulfillment_status_transition(TEXT, TEXT)
  SET search_path = pg_catalog;

-- 2. Deterministic SQL Phone Normalization Helper (Pure invoker helper, non-SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_digits TEXT;
BEGIN
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN NULL;
  END IF;
  v_digits := regexp_replace(p_phone, '\D', '', 'g');
  IF length(v_digits) = 10 THEN
    RETURN '+91' || v_digits;
  ELSIF length(v_digits) = 12 AND v_digits LIKE '91%' THEN
    RETURN '+' || v_digits;
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

-- 3. Extend orders table with durable COD lifecycle & advance payment tracking
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cod_status TEXT DEFAULT 'NOT_COD',
  ADD COLUMN IF NOT EXISTS advance_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS advance_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (advance_amount_paise >= 0),
  ADD COLUMN IF NOT EXISTS advance_payment_id UUID,
  ADD COLUMN IF NOT EXISTS advance_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS cod_confirmation_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS customer_read_token_hash TEXT;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cod_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_cod_status_check CHECK (
  cod_status IN (
    'NOT_COD',
    'COD_PENDING_CONFIRMATION',
    'COD_OTP_PENDING',
    'COD_CONFIRMED',
    'COD_ADVANCE_REQUIRED',
    'COD_ADVANCE_PENDING',
    'COD_APPROVED',
    'COD_REJECTED',
    'COD_HELD',
    'COD_PREPAID_ONLY',
    'COD_EXPIRED'
  )
);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_advance_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_advance_status_check CHECK (
  advance_status IN ('none', 'not_required', 'pending', 'captured', 'failed', 'refunded')
);

-- Payment Method / COD Status Check Invariant
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cod_payment_method_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_cod_payment_method_check CHECK (
  (payment_method = 'online' AND cod_status = 'NOT_COD') OR
  (payment_method = 'cod' AND cod_status <> 'NOT_COD')
);

-- 4. Extend order_items table with manufacturing identity hash & snapshot
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS manufacturing_identity_hash TEXT,
  ADD COLUMN IF NOT EXISTS manufacturing_snapshot_json JSONB;

-- 5. Dedicated COD Advance Payments Table
CREATE TABLE IF NOT EXISTS public.cod_advance_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_order_id TEXT NOT NULL,
  provider_payment_id TEXT,
  provider_event_id TEXT,
  expected_amount_paise BIGINT NOT NULL CHECK (expected_amount_paise > 0),
  captured_amount_paise BIGINT CHECK (captured_amount_paise >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('creating', 'created', 'creation_unknown', 'authorized', 'captured', 'failed', 'refunded')),
  claim_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT idx_unique_cod_advance_order_provider UNIQUE (provider, provider_order_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cod_advance_payments_payment_id 
  ON public.cod_advance_payments(provider_payment_id) 
  WHERE provider_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cod_advance_payments_provider_event 
  ON public.cod_advance_payments(provider_event_id) 
  WHERE provider_event_id IS NOT NULL;

-- Foreign Key from orders to cod_advance_payments
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS fk_orders_advance_payment;
ALTER TABLE public.orders ADD CONSTRAINT fk_orders_advance_payment 
  FOREIGN KEY (advance_payment_id) REFERENCES public.cod_advance_payments(id) ON DELETE SET NULL;

-- 6. Durable COD Lifecycle Events Table
CREATE TABLE IF NOT EXISTS public.cod_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('COD_INITIALIZED', 'COD_CONFIRMED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT idx_unique_cod_lifecycle_event UNIQUE (order_id, event_type)
);

-- 7. ALTER Existing Phase 2 Table: cod_risk_profiles
-- Live Phase 2 schema has: id (UUID), customer_id (UUID NOT NULL), risk_score (INT), is_cod_eligible (BOOLEAN), notes (TEXT), created_at (TIMESTAMPTZ)
ALTER TABLE public.cod_risk_profiles ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.cod_risk_profiles
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
  ADD COLUMN IF NOT EXISTS successful_cod_deliveries INT NOT NULL DEFAULT 0 CHECK (successful_cod_deliveries >= 0),
  ADD COLUMN IF NOT EXISTS successful_prepaid_deliveries INT NOT NULL DEFAULT 0 CHECK (successful_prepaid_deliveries >= 0),
  ADD COLUMN IF NOT EXISTS cod_orders INT NOT NULL DEFAULT 0 CHECK (cod_orders >= 0),
  ADD COLUMN IF NOT EXISTS cod_confirmed_orders INT NOT NULL DEFAULT 0 CHECK (cod_confirmed_orders >= 0),
  ADD COLUMN IF NOT EXISTS rto_count INT NOT NULL DEFAULT 0 CHECK (rto_count >= 0),
  ADD COLUMN IF NOT EXISTS refused_count INT NOT NULL DEFAULT 0 CHECK (refused_count >= 0),
  ADD COLUMN IF NOT EXISTS cancelled_after_confirmation_count INT NOT NULL DEFAULT 0 CHECK (cancelled_after_confirmation_count >= 0),
  ADD COLUMN IF NOT EXISTS last_rto_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_successful_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS risk_band TEXT NOT NULL DEFAULT 'NEW_CUSTOMER',
  ADD COLUMN IF NOT EXISTS prepaid_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_hold BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_cod_risk_profiles_phone 
  ON public.cod_risk_profiles(phone_normalized) 
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cod_risk_profiles_customer 
  ON public.cod_risk_profiles(customer_id);

-- 8. ALTER Existing Phase 2 Table: returned_inventory (Fix Legacy NOT NULL Contract & Inspection Contract)
-- Live Phase 2 schema has: id (UUID), return_id (UUID NOT NULL), variant_id (UUID), condition (TEXT), disposition (TEXT NOT NULL), created_at (TIMESTAMPTZ)
ALTER TABLE public.returned_inventory ALTER COLUMN return_id DROP NOT NULL;
ALTER TABLE public.returned_inventory ALTER COLUMN disposition DROP NOT NULL;

ALTER TABLE public.returned_inventory
  ADD COLUMN IF NOT EXISTS source_order_id TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_order_item_id UUID REFERENCES public.order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fulfillment_id UUID REFERENCES public.fulfillments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS design_id UUID REFERENCES public.designs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS design_version INT,
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS size TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS manufacturing_identity_hash TEXT,
  ADD COLUMN IF NOT EXISTS manufacturing_snapshot_json JSONB,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reuse_status TEXT NOT NULL DEFAULT 'REUSABLE',
  ADD COLUMN IF NOT EXISTS reuse_eligible BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS disposed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replacement_order_id TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.returned_inventory DROP CONSTRAINT IF EXISTS returned_inventory_reuse_status_check;
ALTER TABLE public.returned_inventory ADD CONSTRAINT returned_inventory_reuse_status_check CHECK (
  reuse_status IN ('AWAITING_RECEIPT', 'RECEIVED', 'INSPECTION_REQUIRED', 'REUSABLE', 'RESERVED', 'REUSED', 'DAMAGED', 'DISPOSED')
);

-- Inspection-Only DB Contract (Requirement #16)
ALTER TABLE public.returned_inventory DROP CONSTRAINT IF EXISTS check_returned_inventory_reusable_identity;
ALTER TABLE public.returned_inventory ADD CONSTRAINT check_returned_inventory_reusable_identity CHECK (
  (reuse_status = 'REUSABLE' AND reuse_eligible = true AND manufacturing_identity_hash IS NOT NULL AND trim(manufacturing_identity_hash) <> '' AND manufacturing_snapshot_json IS NOT NULL AND manufacturing_snapshot_json <> '{}'::jsonb)
  OR (reuse_status <> 'REUSABLE' OR reuse_eligible = false)
);

CREATE INDEX IF NOT EXISTS idx_returned_inventory_mfg_hash 
  ON public.returned_inventory(manufacturing_identity_hash, reuse_status);

-- 9. COD OTP Challenges Table
CREATE TABLE IF NOT EXISTS public.cod_otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  phone_normalized TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  sent_at TIMESTAMPTZ NULL DEFAULT NULL,
  resend_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cod_otp_challenges_order 
  ON public.cod_otp_challenges(order_id, phone_normalized);

-- 10. Idempotent Delivery Outcome Events Table
CREATE TABLE IF NOT EXISTS public.delivery_outcome_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id UUID NOT NULL REFERENCES public.fulfillments(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider_event_id TEXT,
  outcome_type TEXT NOT NULL CHECK (outcome_type IN ('DELIVERED', 'RTO', 'REFUSED', 'RETURNED')),
  outcome_status TEXT NOT NULL DEFAULT 'processed',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details_json JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT idx_unique_fulfillment_outcome UNIQUE (fulfillment_id, outcome_type)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_outcome_events_provider_event 
  ON public.delivery_outcome_events(provider_event_id) 
  WHERE provider_event_id IS NOT NULL;

-- 11. Privilege Lockdown & RLS Configuration
ALTER TABLE public.cod_advance_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cod_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cod_risk_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cod_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_outcome_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returned_inventory ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cod_advance_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cod_lifecycle_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cod_risk_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cod_otp_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.delivery_outcome_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.returned_inventory FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.cod_advance_payments TO service_role;
GRANT ALL ON public.cod_lifecycle_events TO service_role;
GRANT ALL ON public.cod_risk_profiles TO service_role;
GRANT ALL ON public.cod_otp_challenges TO service_role;
GRANT ALL ON public.delivery_outcome_events TO service_role;
GRANT ALL ON public.returned_inventory TO service_role;

-- 12. Canonical COD Status Transition Validator (Pure invoker helper, non-SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_valid_cod_status_transition(
  p_current_status TEXT,
  p_target_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_current_status = p_target_status THEN
    RETURN TRUE;
  END IF;

  -- Terminal states through normal transitions
  IF p_current_status IN ('COD_APPROVED', 'COD_PREPAID_ONLY', 'COD_REJECTED') THEN
    RETURN FALSE;
  END IF;

  RETURN CASE p_current_status
    WHEN 'NOT_COD' THEN FALSE
    WHEN 'COD_PENDING_CONFIRMATION' THEN p_target_status IN ('COD_OTP_PENDING', 'COD_CONFIRMED', 'COD_ADVANCE_REQUIRED', 'COD_APPROVED', 'COD_HELD', 'COD_PREPAID_ONLY', 'COD_REJECTED')
    WHEN 'COD_OTP_PENDING' THEN p_target_status IN ('COD_CONFIRMED', 'COD_ADVANCE_REQUIRED', 'COD_APPROVED', 'COD_HELD', 'COD_PREPAID_ONLY', 'COD_REJECTED', 'COD_EXPIRED')
    WHEN 'COD_CONFIRMED' THEN p_target_status IN ('COD_ADVANCE_REQUIRED', 'COD_APPROVED', 'COD_HELD', 'COD_PREPAID_ONLY', 'COD_REJECTED')
    WHEN 'COD_ADVANCE_REQUIRED' THEN p_target_status IN ('COD_ADVANCE_PENDING', 'COD_APPROVED', 'COD_HELD', 'COD_PREPAID_ONLY', 'COD_REJECTED', 'COD_EXPIRED')
    WHEN 'COD_ADVANCE_PENDING' THEN p_target_status IN ('COD_APPROVED', 'COD_HELD', 'COD_PREPAID_ONLY', 'COD_REJECTED', 'COD_EXPIRED')
    WHEN 'COD_HELD' THEN p_target_status IN ('COD_CONFIRMED', 'COD_ADVANCE_REQUIRED', 'COD_APPROVED', 'COD_PREPAID_ONLY', 'COD_REJECTED')
    WHEN 'COD_EXPIRED' THEN p_target_status IN ('COD_OTP_PENDING', 'COD_ADVANCE_PENDING')
    ELSE FALSE
  END;
END;
$$;

-- 13. Atomic SECURITY DEFINER RPC: apply_cod_decision_with_audit
CREATE OR REPLACE FUNCTION public.apply_cod_decision_with_audit(
  p_order_id TEXT,
  p_target_status TEXT,
  p_decision_reason TEXT,
  p_advance_required BOOLEAN DEFAULT FALSE,
  p_advance_amount_paise BIGINT DEFAULT 0,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order RECORD;
  v_old_status TEXT;
  v_phone TEXT;
  v_admin RECORD;
  v_init_event RECORD;
  v_conf_event RECORD;
BEGIN
  IF p_admin_id IS NOT NULL THEN
    SELECT * INTO v_admin FROM public.admin_profiles WHERE id = p_admin_id AND is_active = true AND role IN ('owner', 'admin');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Admin ID % is not an active owner or admin', p_admin_id;
    END IF;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  IF v_order.payment_method <> 'cod' THEN
    RAISE EXCEPTION 'Order % is not a Cash on Delivery order', p_order_id;
  END IF;

  v_old_status := COALESCE(v_order.cod_status, 'COD_PENDING_CONFIRMATION');

  IF NOT public.is_valid_cod_status_transition(v_old_status, p_target_status) THEN
    RAISE EXCEPTION 'Invalid COD status transition from % to % for order %', v_old_status, p_target_status, p_order_id;
  END IF;

  UPDATE public.orders
  SET cod_status = p_target_status,
      advance_required = p_advance_required,
      advance_amount_paise = p_advance_amount_paise,
      advance_status = CASE WHEN p_advance_required THEN 'pending' ELSE 'not_required' END,
      updated_at = now()
  WHERE id = p_order_id;

  v_phone := public.normalize_phone(v_order.shipping_address->>'phone');

  -- Exactly-Once COD Lifecycle Event Counter Accounting (Requirement #5)
  IF v_phone IS NOT NULL THEN
    INSERT INTO public.cod_lifecycle_events (order_id, event_type)
    VALUES (p_order_id, 'COD_INITIALIZED')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_init_event;

    IF v_init_event.id IS NOT NULL THEN
      INSERT INTO public.cod_risk_profiles (phone_normalized, cod_orders, updated_at)
      VALUES (v_phone, 1, now())
      ON CONFLICT (phone_normalized) DO UPDATE
      SET cod_orders = public.cod_risk_profiles.cod_orders + 1,
          updated_at = now();
    END IF;

    IF p_target_status IN ('COD_CONFIRMED', 'COD_APPROVED') THEN
      INSERT INTO public.cod_lifecycle_events (order_id, event_type)
      VALUES (p_order_id, 'COD_CONFIRMED')
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_conf_event;

      IF v_conf_event.id IS NOT NULL THEN
        INSERT INTO public.cod_risk_profiles (phone_normalized, cod_confirmed_orders, updated_at)
        VALUES (v_phone, 1, now())
        ON CONFLICT (phone_normalized) DO UPDATE
        SET cod_confirmed_orders = public.cod_risk_profiles.cod_confirmed_orders + 1,
            updated_at = now();
      END IF;
    END IF;
  END IF;

  -- Atomic set_prepaid_only update (Requirement #6)
  IF p_target_status = 'COD_PREPAID_ONLY' AND v_phone IS NOT NULL THEN
    INSERT INTO public.cod_risk_profiles (phone_normalized, prepaid_only, risk_band, risk_score, is_cod_eligible, updated_at)
    VALUES (v_phone, true, 'PREPAID_ONLY', 90, false, now())
    ON CONFLICT (phone_normalized) DO UPDATE
    SET prepaid_only = true,
        risk_band = 'PREPAID_ONLY',
        risk_score = 90,
        is_cod_eligible = false,
        updated_at = now();
  END IF;

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json, created_at)
  VALUES (
    p_admin_id,
    'APPLY_COD_DECISION',
    'ORDER',
    p_order_id,
    jsonb_build_object(
      'previous_status', v_old_status,
      'new_status', p_target_status,
      'reason', p_decision_reason,
      'advance_required', p_advance_required,
      'advance_amount_paise', p_advance_amount_paise
    ),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'cod_status', p_target_status);
END;
$$;

-- 14. Atomic SECURITY DEFINER RPC: override_cod_status_with_audit (Owner/Admin Only)
CREATE OR REPLACE FUNCTION public.override_cod_status_with_audit(
  p_order_id TEXT,
  p_target_status TEXT,
  p_override_reason TEXT,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order RECORD;
  v_old_status TEXT;
  v_admin RECORD;
  v_phone TEXT;
BEGIN
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'Admin ID is required for operational COD override';
  END IF;

  SELECT * INTO v_admin FROM public.admin_profiles WHERE id = p_admin_id AND is_active = true AND role IN ('owner', 'admin');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin ID % is not an active owner or admin', p_admin_id;
  END IF;

  IF p_override_reason IS NULL OR trim(p_override_reason) = '' THEN
    RAISE EXCEPTION 'Mandatory override reason is required';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  v_old_status := COALESCE(v_order.cod_status, 'NOT_COD');

  UPDATE public.orders
  SET cod_status = p_target_status,
      updated_at = now()
  WHERE id = p_order_id;

  v_phone := public.normalize_phone(v_order.shipping_address->>'phone');
  IF p_target_status = 'COD_PREPAID_ONLY' AND v_phone IS NOT NULL THEN
    INSERT INTO public.cod_risk_profiles (phone_normalized, prepaid_only, risk_band, risk_score, is_cod_eligible, updated_at)
    VALUES (v_phone, true, 'PREPAID_ONLY', 90, false, now())
    ON CONFLICT (phone_normalized) DO UPDATE
    SET prepaid_only = true,
        risk_band = 'PREPAID_ONLY',
        risk_score = 90,
        is_cod_eligible = false,
        updated_at = now();
  END IF;

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json, created_at)
  VALUES (
    p_admin_id,
    'OVERRIDE_COD_STATUS',
    'ORDER',
    p_order_id,
    jsonb_build_object(
      'previous_status', v_old_status,
      'override_status', p_target_status,
      'reason', p_override_reason
    ),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'cod_status', p_target_status);
END;
$$;

-- 15. Atomic SECURITY DEFINER RPC: create_cod_otp_challenge_with_audit
CREATE OR REPLACE FUNCTION public.create_cod_otp_challenge_with_audit(
  p_order_id TEXT,
  p_token_hash TEXT,
  p_phone_normalized TEXT,
  p_otp_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order RECORD;
  v_latest RECORD;
  v_resend_count INT := 1;
  v_challenge_id UUID;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  IF v_order.payment_method <> 'cod' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_cod');
  END IF;

  IF v_order.cod_confirmation_token_hash IS NULL OR v_order.cod_confirmation_token_hash <> p_token_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_confirmation_token');
  END IF;

  -- Rejects OTP creation from terminal or advanced decision states (Requirement #2)
  IF NOT public.is_valid_cod_status_transition(COALESCE(v_order.cod_status, 'COD_PENDING_CONFIRMATION'), 'COD_OTP_PENDING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_create_otp_in_terminal_or_advanced_state');
  END IF;

  -- Query latest OTP challenge for order REGARDLESS of delivery_status or consumed_at (Requirement #3)
  SELECT * INTO v_latest
  FROM public.cod_otp_challenges
  WHERE order_id = p_order_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_latest.created_at > (now() - INTERVAL '60 seconds') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'otp_resend_cooldown_active');
    END IF;

    IF v_latest.resend_count >= 3 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'otp_max_resends_exceeded');
    END IF;

    v_resend_count := v_latest.resend_count + 1;
    IF v_latest.consumed_at IS NULL THEN
      UPDATE public.cod_otp_challenges
      SET consumed_at = now()
      WHERE id = v_latest.id;
    END IF;
  END IF;

  INSERT INTO public.cod_otp_challenges (
    order_id, phone_normalized, otp_hash, expires_at, delivery_status, resend_count, sent_at, created_at
  ) VALUES (
    p_order_id, p_phone_normalized, p_otp_hash, p_expires_at, 'pending', v_resend_count, NULL, now()
  )
  RETURNING id INTO v_challenge_id;

  UPDATE public.orders SET cod_status = 'COD_OTP_PENDING' WHERE id = p_order_id;

  -- Exactly-once COD_INITIALIZED accounting
  PERFORM public.apply_cod_decision_with_audit(p_order_id, 'COD_OTP_PENDING', 'OTP Challenge Created');

  INSERT INTO public.audit_logs (action, entity_type, entity_id, details_json, created_at)
  VALUES (
    'CREATE_OTP_CHALLENGE',
    'COD_OTP_CHALLENGE',
    v_challenge_id::text,
    jsonb_build_object('order_id', p_order_id, 'resend_count', v_resend_count),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'challenge_id', v_challenge_id, 'order_id', p_order_id, 'resend_count', v_resend_count);
END;
$$;

-- 16. Atomic RPC: mark_cod_otp_challenge_sent (Requirement #1)
CREATE OR REPLACE FUNCTION public.mark_cod_otp_challenge_sent(
  p_challenge_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_chal RECORD;
BEGIN
  SELECT * INTO v_chal FROM public.cod_otp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'challenge_not_found');
  END IF;

  IF v_chal.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'challenge_already_consumed');
  END IF;

  IF v_chal.delivery_status = 'sent' THEN
    RETURN jsonb_build_object('ok', true, 'already_sent', true, 'challenge_id', p_challenge_id);
  END IF;

  IF v_chal.delivery_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'challenge_status_not_pending');
  END IF;

  UPDATE public.cod_otp_challenges
  SET delivery_status = 'sent',
      sent_at = now()
  WHERE id = p_challenge_id;

  RETURN jsonb_build_object('ok', true, 'already_sent', false, 'challenge_id', p_challenge_id);
END;
$$;

-- 17. Atomic RPC: mark_cod_otp_challenge_failed
CREATE OR REPLACE FUNCTION public.mark_cod_otp_challenge_failed(
  p_challenge_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.cod_otp_challenges
  SET delivery_status = 'failed',
      consumed_at = now()
  WHERE id = p_challenge_id;

  RETURN jsonb_build_object('ok', true, 'challenge_id', p_challenge_id);
END;
$$;

-- 18. Atomic SECURITY DEFINER RPC: verify_cod_otp_and_apply_decision_with_audit (Requirement #4)
CREATE OR REPLACE FUNCTION public.verify_cod_otp_and_apply_decision_with_audit(
  p_order_id TEXT,
  p_token_hash TEXT,
  p_submitted_otp_hash TEXT,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order RECORD;
  v_challenge RECORD;
  v_phone TEXT;
  v_profile RECORD;
  v_target_status TEXT := 'COD_APPROVED';
  v_advance_req BOOLEAN := FALSE;
  v_advance_amt BIGINT := 0;
  v_conf_event RECORD;
  v_item_count INT := 0;
  v_today_exposure BIGINT := 0;
  v_today_kolkata TEXT;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  -- Stale OTP Protection (Requirement #5): Require order state = COD_OTP_PENDING
  IF v_order.cod_status <> 'COD_OTP_PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cod_state_changed');
  END IF;

  IF v_order.cod_confirmation_token_hash IS NULL OR v_order.cod_confirmation_token_hash <> p_token_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_confirmation_token');
  END IF;

  SELECT * INTO v_challenge
  FROM public.cod_otp_challenges
  WHERE order_id = p_order_id AND consumed_at IS NULL AND delivery_status = 'sent'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_active_otp_challenge');
  END IF;

  IF v_challenge.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'otp_expired');
  END IF;

  IF v_challenge.attempts >= v_challenge.max_attempts THEN
    RETURN jsonb_build_object('ok', false, 'error', 'otp_max_attempts_exceeded');
  END IF;

  IF v_challenge.otp_hash <> p_submitted_otp_hash THEN
    UPDATE public.cod_otp_challenges
    SET attempts = attempts + 1
    WHERE id = v_challenge.id;

    RETURN jsonb_build_object('ok', false, 'error', 'invalid_otp', 'remaining_attempts', (v_challenge.max_attempts - (v_challenge.attempts + 1)));
  END IF;

  -- OTP Verified! Compute Authoritative COD Decision matching TS policy exactly (Requirement #4)
  v_phone := public.normalize_phone(v_order.shipping_address->>'phone');
  IF v_phone IS NOT NULL THEN
    SELECT * INTO v_profile FROM public.cod_risk_profiles WHERE phone_normalized = v_phone;
  END IF;

  -- Compute total item quantity
  SELECT COALESCE(SUM(quantity), 0) INTO v_item_count FROM public.order_items WHERE order_id = p_order_id;

  -- Calculate Asia/Kolkata daily active COD exposure
  v_today_kolkata := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD');
  SELECT COALESCE(SUM(total_paise), 0) INTO v_today_exposure
  FROM public.orders
  WHERE payment_method = 'cod'
    AND cod_status IN ('COD_APPROVED', 'COD_CONFIRMED', 'COD_ADVANCE_PENDING')
    AND to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = v_today_kolkata;

  IF v_profile.prepaid_only OR (COALESCE(v_profile.rto_count, 0) >= 2) THEN
    v_target_status := 'COD_PREPAID_ONLY';
  ELSIF COALESCE(v_profile.manual_hold, false) OR v_today_exposure >= 5000000 THEN
    v_target_status := 'COD_HELD';
  ELSIF v_order.total_paise > 500000 OR v_item_count > 3 OR COALESCE(v_profile.rto_count, 0) > 0 OR COALESCE(v_profile.refused_count, 0) > 0 THEN
    v_target_status := 'COD_ADVANCE_REQUIRED';
    v_advance_req := TRUE;
    v_advance_amt := 20000; -- ₹200 default high-risk booking advance (Requirement #4)
  ELSIF COALESCE(v_profile.successful_cod_deliveries, 0) >= 2 AND COALESCE(v_profile.rto_count, 0) = 0 THEN
    v_target_status := 'COD_APPROVED';
  ELSE
    v_target_status := 'COD_APPROVED';
  END IF;

  IF NOT public.is_valid_cod_status_transition(v_order.cod_status, v_target_status) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cod_state_changed');
  END IF;

  -- Consume OTP challenge
  UPDATE public.cod_otp_challenges
  SET consumed_at = now(), verified_at = now()
  WHERE id = v_challenge.id;

  -- Update order COD status
  UPDATE public.orders
  SET cod_status = v_target_status,
      advance_required = v_advance_req,
      advance_amount_paise = v_advance_amt,
      advance_status = CASE WHEN v_advance_req THEN 'pending' ELSE 'not_required' END,
      updated_at = now()
  WHERE id = p_order_id;

  -- Atomic prepaid_only update if needed (Requirement #6)
  IF v_target_status = 'COD_PREPAID_ONLY' AND v_phone IS NOT NULL THEN
    INSERT INTO public.cod_risk_profiles (phone_normalized, prepaid_only, risk_band, risk_score, is_cod_eligible, updated_at)
    VALUES (v_phone, true, 'PREPAID_ONLY', 90, false, now())
    ON CONFLICT (phone_normalized) DO UPDATE
    SET prepaid_only = true,
        risk_band = 'PREPAID_ONLY',
        risk_score = 90,
        is_cod_eligible = false,
        updated_at = now();
  END IF;

  -- Exactly-Once Counter Updates: COD_CONFIRMED ONLY when target is COD_APPROVED or COD_CONFIRMED (Requirement #5)
  IF v_phone IS NOT NULL AND v_target_status IN ('COD_CONFIRMED', 'COD_APPROVED') THEN
    INSERT INTO public.cod_lifecycle_events (order_id, event_type)
    VALUES (p_order_id, 'COD_CONFIRMED')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_conf_event;

    IF v_conf_event.id IS NOT NULL THEN
      INSERT INTO public.cod_risk_profiles (phone_normalized, cod_confirmed_orders, updated_at)
      VALUES (v_phone, 1, now())
      ON CONFLICT (phone_normalized) DO UPDATE
      SET cod_confirmed_orders = public.cod_risk_profiles.cod_confirmed_orders + 1,
          updated_at = now();
    END IF;
  END IF;

  INSERT INTO public.audit_logs (action, entity_type, entity_id, details_json, created_at)
  VALUES (
    'VERIFY_OTP_AND_APPLY_DECISION',
    'ORDER',
    p_order_id,
    jsonb_build_object('order_id', p_order_id, 'cod_status', v_target_status, 'advance_required', v_advance_req),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'cod_status', v_target_status, 'advance_required', v_advance_req);
END;
$$;

-- 19. Atomic SECURITY DEFINER RPC: capture_cod_advance_with_audit (Requirements #6 & #10: Reordered Idempotency Before State Gate)
CREATE OR REPLACE FUNCTION public.capture_cod_advance_with_audit(
  p_order_id TEXT,
  p_provider_order_id TEXT,
  p_provider_payment_id TEXT,
  p_captured_amount_paise BIGINT,
  p_provider_event_id TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT 'INR',
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order RECORD;
  v_advance_row RECORD;
BEGIN
  -- Lock PRE-CREATED advance payment row FIRST (Requirement #6)
  SELECT * INTO v_advance_row
  FROM public.cod_advance_payments
  WHERE order_id = p_order_id AND provider_order_id = p_provider_order_id AND provider = 'razorpay'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'advance_payment_row_not_found');
  END IF;

  IF v_advance_row.expected_amount_paise <> p_captured_amount_paise THEN
    RETURN jsonb_build_object('ok', false, 'error', 'captured_amount_mismatch');
  END IF;

  IF v_advance_row.currency <> p_currency THEN
    RETURN jsonb_build_object('ok', false, 'error', 'currency_mismatch');
  END IF;

  -- Reorder Check: Check captured payment / event replay BEFORE order state gate so duplicate callbacks succeed when order is already COD_APPROVED
  IF p_provider_event_id IS NOT NULL AND trim(p_provider_event_id) <> '' THEN
    IF v_advance_row.provider_event_id = p_provider_event_id THEN
      RETURN jsonb_build_object('ok', true, 'already_processed', true, 'already_captured', (v_advance_row.status = 'captured'), 'order_id', p_order_id);
    ELSIF v_advance_row.provider_event_id IS NOT NULL AND v_advance_row.provider_event_id <> p_provider_event_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'provider_event_rebound');
    END IF;
  END IF;

  IF v_advance_row.status = 'captured' THEN
    IF v_advance_row.provider_payment_id = p_provider_payment_id THEN
      RETURN jsonb_build_object('ok', true, 'already_captured', true, 'order_id', p_order_id);
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'provider_payment_rebound');
    END IF;
  END IF;

  -- ONLY for a FIRST capture require order state IN ('COD_ADVANCE_REQUIRED', 'COD_ADVANCE_PENDING')
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  IF v_order.payment_method <> 'cod' OR NOT v_order.advance_required THEN
    RETURN jsonb_build_object('ok', false, 'error', 'advance_not_required_for_order');
  END IF;

  IF v_order.cod_status NOT IN ('COD_ADVANCE_REQUIRED', 'COD_ADVANCE_PENDING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_in_advance_pending_state');
  END IF;

  IF v_order.advance_amount_paise <> p_captured_amount_paise THEN
    RETURN jsonb_build_object('ok', false, 'error', 'captured_amount_mismatch');
  END IF;

  -- Requirement #6: Cross-row rebound check for provider_payment_id
  IF p_provider_payment_id IS NOT NULL AND trim(p_provider_payment_id) <> '' THEN
    PERFORM 1 FROM public.cod_advance_payments WHERE provider = 'razorpay' AND provider_payment_id = p_provider_payment_id AND id <> v_advance_row.id;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'provider_payment_rebound');
    END IF;
  END IF;

  -- Requirement #6: Cross-row rebound check for provider_event_id
  IF p_provider_event_id IS NOT NULL AND trim(p_provider_event_id) <> '' THEN
    PERFORM 1 FROM public.cod_advance_payments WHERE provider = 'razorpay' AND provider_event_id = p_provider_event_id AND id <> v_advance_row.id;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'provider_event_rebound');
    END IF;
  END IF;

  UPDATE public.cod_advance_payments
  SET provider_payment_id = p_provider_payment_id,
      provider_event_id = p_provider_event_id,
      captured_amount_paise = p_captured_amount_paise,
      status = 'captured',
      captured_at = now(),
      updated_at = now()
  WHERE id = v_advance_row.id;

  UPDATE public.orders
  SET cod_status = 'COD_APPROVED',
      advance_status = 'captured',
      advance_payment_id = v_advance_row.id,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json, created_at)
  VALUES (
    p_admin_id,
    'CAPTURE_COD_ADVANCE',
    'ORDER',
    p_order_id,
    jsonb_build_object(
      'provider_order_id', p_provider_order_id,
      'provider_payment_id', p_provider_payment_id,
      'captured_amount_paise', p_captured_amount_paise
    ),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'already_captured', false, 'order_id', p_order_id, 'cod_status', 'COD_APPROVED');
END;
$$;

-- 19b. Atomic SECURITY DEFINER RPC: claim_cod_advance_checkout_with_audit (Requirement #2: Durable Claim Token & Lease Lifecycle)
CREATE OR REPLACE FUNCTION public.claim_cod_advance_checkout_with_audit(
  p_order_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order RECORD;
  v_existing RECORD;
  v_claim_token TEXT;
  v_payment_id UUID;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  IF v_order.payment_method <> 'cod' OR NOT v_order.advance_required THEN
    RETURN jsonb_build_object('ok', false, 'error', 'advance_not_required_for_order');
  END IF;

  IF v_order.cod_status NOT IN ('COD_ADVANCE_REQUIRED', 'COD_ADVANCE_PENDING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_in_advance_required_state');
  END IF;

  -- Lock existing advance payment row if present
  SELECT * INTO v_existing
  FROM public.cod_advance_payments
  WHERE order_id = p_order_id AND provider = 'razorpay' AND status IN ('creating', 'created', 'creation_unknown', 'authorized', 'captured')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'creation_unknown' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'advance_creation_reconciliation_required',
        'payment_id', v_existing.id
      );
    ELSIF v_existing.status = 'created' OR v_existing.status = 'captured' OR v_existing.status = 'authorized' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'creator', false,
        'already_created', true,
        'creation_in_progress', false,
        'payment_id', v_existing.id,
        'razorpay_order_id', v_existing.provider_order_id,
        'amount_paise', v_existing.expected_amount_paise,
        'currency', v_existing.currency
      );
    ELSIF v_existing.status = 'creating' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'creator', false,
        'already_created', false,
        'creation_in_progress', true,
        'payment_id', v_existing.id,
        'amount_paise', v_existing.expected_amount_paise,
        'currency', v_existing.currency
      );
    END IF;
  END IF;

  -- Generate unique claim token
  v_claim_token := 'claim_' || gen_random_uuid()::text;

  INSERT INTO public.cod_advance_payments (
    order_id, provider, provider_order_id, expected_amount_paise, currency, status, claim_token, created_at, updated_at
  ) VALUES (
    p_order_id, 'razorpay', 'pending_claim_' || v_claim_token, COALESCE(v_order.advance_amount_paise, 20000), COALESCE(v_order.currency, 'INR'), 'creating', v_claim_token, now(), now()
  )
  RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'creator', true,
    'already_created', false,
    'creation_in_progress', false,
    'claim_token', v_claim_token,
    'payment_id', v_payment_id,
    'amount_paise', COALESCE(v_order.advance_amount_paise, 20000),
    'currency', COALESCE(v_order.currency, 'INR')
  );
END;
$$;

-- 19c. Atomic SECURITY DEFINER RPC: mark_cod_advance_creation_unknown_with_audit (Requirement #3: Audited Creation Unknown RPC)
CREATE OR REPLACE FUNCTION public.mark_cod_advance_creation_unknown_with_audit(
  p_payment_id UUID,
  p_order_id TEXT,
  p_claim_token TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment RECORD;
BEGIN
  SELECT * INTO v_payment
  FROM public.cod_advance_payments
  WHERE id = p_payment_id AND order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'advance_payment_row_not_found');
  END IF;

  IF v_payment.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_claim_token');
  END IF;

  IF v_payment.status <> 'creating' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_status_for_creation_unknown');
  END IF;

  UPDATE public.cod_advance_payments
  SET status = 'creation_unknown',
      updated_at = now()
  WHERE id = p_payment_id;

  RETURN jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'status', 'creation_unknown');
END;
$$;

-- 19d. Atomic SECURITY DEFINER RPC: bind_cod_advance_provider_order_with_audit (Requirements #4, #5: Order Revalidation & Rebound Safety)
CREATE OR REPLACE FUNCTION public.bind_cod_advance_provider_order_with_audit(
  p_payment_id UUID,
  p_order_id TEXT,
  p_claim_token TEXT,
  p_provider_order_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment RECORD;
  v_order RECORD;
BEGIN
  IF p_provider_order_id IS NULL OR trim(p_provider_order_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_order_id_required');
  END IF;

  -- Lock payment row
  SELECT * INTO v_payment
  FROM public.cod_advance_payments
  WHERE id = p_payment_id AND order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'advance_payment_row_not_found');
  END IF;

  IF v_payment.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_claim_token');
  END IF;

  IF v_payment.status = 'created' AND v_payment.provider_order_id = p_provider_order_id THEN
    RETURN jsonb_build_object('ok', true, 'already_bound', true, 'payment_id', p_payment_id, 'provider_order_id', p_provider_order_id);
  END IF;

  IF v_payment.status <> 'creating' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_status_for_binding');
  END IF;

  -- Requirement #5: Check if provider_order_id already belongs to another cod_advance_payment
  PERFORM 1 FROM public.cod_advance_payments WHERE provider = 'razorpay' AND provider_order_id = p_provider_order_id AND id <> p_payment_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_order_rebound');
  END IF;

  -- Lock order row FOR UPDATE
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  -- Store provider_order_id on payment row
  UPDATE public.cod_advance_payments
  SET provider_order_id = p_provider_order_id,
      status = 'created',
      updated_at = now()
  WHERE id = p_payment_id;

  -- Requirement #4: Revalidate order state
  IF v_order.payment_method <> 'cod' OR NOT v_order.advance_required OR v_order.cod_status NOT IN ('COD_ADVANCE_REQUIRED', 'COD_ADVANCE_PENDING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cod_state_changed_during_provider_creation', 'provider_order_id', p_provider_order_id);
  END IF;

  UPDATE public.orders
  SET cod_status = 'COD_ADVANCE_PENDING',
      advance_status = 'pending',
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'provider_order_id', p_provider_order_id);
END;
$$;

-- 20. Atomic SECURITY DEFINER RPC: save_returned_inventory_with_audit (Requirements #12, #13, #14: DB-Authoritative Source Identity & Rebound Protection)
CREATE OR REPLACE FUNCTION public.save_returned_inventory_with_audit(
  p_id UUID,
  p_source_order_id TEXT,
  p_source_order_item_id UUID,
  p_fulfillment_id UUID,
  p_product_id UUID,
  p_variant_id UUID,
  p_design_id UUID,
  p_design_version INT,
  p_sku TEXT,
  p_size TEXT,
  p_color TEXT,
  p_condition TEXT,
  p_manufacturing_identity_hash TEXT,
  p_manufacturing_snapshot_json JSONB,
  p_received_at TIMESTAMPTZ,
  p_reuse_status TEXT,
  p_reuse_eligible BOOLEAN,
  p_notes TEXT,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing RECORD;
  v_src_item RECORD;
  v_effective_src_order_id TEXT := p_source_order_id;
  v_effective_product_id UUID := p_product_id;
  v_effective_variant_id UUID := p_variant_id;
  v_effective_sku TEXT := p_sku;
  v_effective_hash TEXT := p_manufacturing_identity_hash;
  v_effective_snap JSONB := p_manufacturing_snapshot_json;
  v_effective_status TEXT := COALESCE(p_reuse_status, 'REUSABLE');
  v_effective_eligible BOOLEAN := COALESCE(p_reuse_eligible, true);
BEGIN
  -- Requirement #12: If source_order_item_id is supplied, load order_items in SQL directly
  IF p_source_order_item_id IS NOT NULL THEN
    SELECT * INTO v_src_item FROM public.order_items WHERE id = p_source_order_item_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'source_order_item_not_found');
    END IF;

    -- Derive authoritative identity from DB
    v_effective_src_order_id := v_src_item.order_id;
    v_effective_product_id := v_src_item.product_id;
    v_effective_variant_id := v_src_item.variant_id;
    v_effective_sku := v_src_item.sku;
    v_effective_hash := v_src_item.manufacturing_identity_hash;
    v_effective_snap := v_src_item.manufacturing_snapshot_json;

    -- Reject conflicting caller parameters
    IF (p_product_id IS NOT NULL AND p_product_id <> v_src_item.product_id) OR
       (p_variant_id IS NOT NULL AND p_variant_id <> v_src_item.variant_id) OR
       (p_sku IS NOT NULL AND p_sku <> v_src_item.sku) THEN
      RAISE EXCEPTION 'source_order_item_identity_mismatch';
    END IF;

    -- If exact source item has no manufacturing identity, it cannot become REUSABLE
    IF v_effective_hash IS NULL OR trim(v_effective_hash) = '' THEN
      v_effective_status := 'INSPECTION_REQUIRED';
      v_effective_eligible := false;
    END IF;
  ELSE
    -- Requirement #13: Inspection-only manual returns when no source item is provided
    v_effective_status := 'INSPECTION_REQUIRED';
    v_effective_eligible := false;
  END IF;

  SELECT * INTO v_existing FROM public.returned_inventory WHERE id = p_id FOR UPDATE;

  IF FOUND THEN
    -- Requirement #14: Returned Inventory Rebound Protection on existing IDs using IS DISTINCT FROM
    IF (v_existing.source_order_item_id IS DISTINCT FROM p_source_order_item_id) OR
       (v_existing.source_order_id IS DISTINCT FROM v_effective_src_order_id) OR
       (v_existing.product_id IS DISTINCT FROM v_effective_product_id) OR
       (v_existing.variant_id IS DISTINCT FROM v_effective_variant_id) OR
       (v_existing.sku IS DISTINCT FROM v_effective_sku) OR
       (v_existing.manufacturing_identity_hash IS DISTINCT FROM v_effective_hash) OR
       (v_existing.manufacturing_snapshot_json IS DISTINCT FROM v_effective_snap) THEN
      RAISE EXCEPTION 'Cannot modify immutable manufacturing identity of existing returned inventory item %', p_id;
    END IF;

    UPDATE public.returned_inventory
    SET condition = p_condition,
        reuse_status = v_effective_status,
        reuse_eligible = v_effective_eligible,
        notes = COALESCE(p_notes, v_existing.notes),
        updated_at = now()
    WHERE id = p_id;
  ELSE
    INSERT INTO public.returned_inventory (
      id, source_order_id, source_order_item_id, fulfillment_id, product_id, variant_id, design_id, design_version,
      sku, size, color, condition, manufacturing_identity_hash, manufacturing_snapshot_json, received_at,
      reuse_status, reuse_eligible, notes, updated_at
    ) VALUES (
      p_id, v_effective_src_order_id, p_source_order_item_id, p_fulfillment_id, v_effective_product_id, v_effective_variant_id, p_design_id, p_design_version,
      v_effective_sku, p_size, p_color, p_condition, v_effective_hash, v_effective_snap, COALESCE(p_received_at, now()),
      v_effective_status, v_effective_eligible, p_notes, now()
    );
  END IF;

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json, created_at)
  VALUES (
    p_admin_id,
    'SAVE_RETURNED_INVENTORY',
    'RETURNED_INVENTORY',
    p_id::text,
    jsonb_build_object('sku', v_effective_sku, 'reuse_status', v_effective_status, 'mfg_hash', v_effective_hash),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'inventory_id', p_id);
END;
$$;

-- 21. Atomic SECURITY DEFINER RPC: record_delivery_outcome_with_audit (Requirements #18, #19, #20)
CREATE OR REPLACE FUNCTION public.record_delivery_outcome_with_audit(
  p_fulfillment_id UUID,
  p_outcome_type TEXT,
  p_provider_event_id TEXT DEFAULT NULL,
  p_details_json JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ful RECORD;
  v_order RECORD;
  v_phone TEXT;
  v_existing_event RECORD;
  v_event_inserted RECORD;
  v_prof RECORD;
  v_rto_cnt INT;
  v_refused_cnt INT;
  v_cod_succ INT;
  v_band TEXT;
  v_score INT;
  v_prepaid_only BOOLEAN;
  v_status_upper TEXT;
BEGIN
  SELECT * INTO v_ful FROM public.fulfillments WHERE id = p_fulfillment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fulfillment_not_found');
  END IF;

  v_status_upper := upper(COALESCE(v_ful.status, ''));

  -- Validate outcome type against fulfillment status (Uppercase Phase 6 parity, Requirement #18)
  IF p_outcome_type = 'DELIVERED' AND v_status_upper NOT IN ('IN_TRANSIT', 'DELIVERED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fulfillment_status_incompatible_with_delivery');
  ELSIF p_outcome_type IN ('RTO', 'RETURNED') AND v_status_upper NOT IN ('IN_TRANSIT', 'RTO_INITIATED', 'RETURNED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fulfillment_status_incompatible_with_rto');
  ELSIF p_outcome_type = 'REFUSED' AND v_status_upper NOT IN ('IN_TRANSIT', 'RTO_INITIATED', 'FAILED', 'EXCEPTION') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fulfillment_status_incompatible_with_refusal');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_ful.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  -- Requirement #19: Deterministic Provider-Event Rebound Check BEFORE counter updates
  IF p_provider_event_id IS NOT NULL AND trim(p_provider_event_id) <> '' THEN
    SELECT * INTO v_existing_event
    FROM public.delivery_outcome_events
    WHERE provider_event_id = p_provider_event_id;

    IF FOUND THEN
      IF v_existing_event.fulfillment_id = p_fulfillment_id AND v_existing_event.outcome_type = p_outcome_type THEN
        RETURN jsonb_build_object('ok', true, 'alreadyProcessed', true, 'fulfillment_id', p_fulfillment_id);
      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'provider_event_rebound');
      END IF;
    END IF;
  END IF;

  -- Race-Safe Idempotent Outcome Insertion (Requirement #21)
  INSERT INTO public.delivery_outcome_events (
    fulfillment_id, order_id, provider_event_id, outcome_type, outcome_status, details_json, processed_at
  ) VALUES (
    p_fulfillment_id, v_ful.order_id, p_provider_event_id, p_outcome_type, 'processed', p_details_json, now()
  )
  ON CONFLICT (fulfillment_id, outcome_type) DO NOTHING
  RETURNING id INTO v_event_inserted;

  IF v_event_inserted.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'alreadyProcessed', true, 'fulfillment_id', p_fulfillment_id);
  END IF;

  v_phone := public.normalize_phone(v_order.shipping_address->>'phone');

  IF v_phone IS NOT NULL THEN
    IF v_order.payment_method = 'cod' THEN
      INSERT INTO public.cod_risk_profiles (
        phone_normalized, successful_cod_deliveries, rto_count, refused_count, last_successful_delivery_at, last_rto_at, updated_at
      ) VALUES (
        v_phone,
        CASE WHEN p_outcome_type = 'DELIVERED' THEN 1 ELSE 0 END,
        CASE WHEN p_outcome_type IN ('RTO', 'RETURNED') THEN 1 ELSE 0 END,
        CASE WHEN p_outcome_type = 'REFUSED' THEN 1 ELSE 0 END,
        CASE WHEN p_outcome_type = 'DELIVERED' THEN now() ELSE NULL END,
        CASE WHEN p_outcome_type IN ('RTO', 'RETURNED', 'REFUSED') THEN now() ELSE NULL END,
        now()
      )
      ON CONFLICT (phone_normalized) DO UPDATE
      SET successful_cod_deliveries = CASE WHEN p_outcome_type = 'DELIVERED' THEN public.cod_risk_profiles.successful_cod_deliveries + 1 ELSE public.cod_risk_profiles.successful_cod_deliveries END,
          rto_count = CASE WHEN p_outcome_type IN ('RTO', 'RETURNED') THEN public.cod_risk_profiles.rto_count + 1 ELSE public.cod_risk_profiles.rto_count END,
          refused_count = CASE WHEN p_outcome_type = 'REFUSED' THEN public.cod_risk_profiles.refused_count + 1 ELSE public.cod_risk_profiles.refused_count END,
          last_successful_delivery_at = CASE WHEN p_outcome_type = 'DELIVERED' THEN now() ELSE public.cod_risk_profiles.last_successful_delivery_at END,
          last_rto_at = CASE WHEN p_outcome_type IN ('RTO', 'RETURNED', 'REFUSED') THEN now() ELSE public.cod_risk_profiles.last_rto_at END,
          updated_at = now();
    ELSE
      -- Prepaid order outcome parity (Requirement #20: RTO/refusal incremented for prepaid too)
      INSERT INTO public.cod_risk_profiles (
        phone_normalized, successful_prepaid_deliveries, rto_count, refused_count, last_successful_delivery_at, last_rto_at, updated_at
      ) VALUES (
        v_phone,
        CASE WHEN p_outcome_type = 'DELIVERED' THEN 1 ELSE 0 END,
        CASE WHEN p_outcome_type IN ('RTO', 'RETURNED') THEN 1 ELSE 0 END,
        CASE WHEN p_outcome_type = 'REFUSED' THEN 1 ELSE 0 END,
        CASE WHEN p_outcome_type = 'DELIVERED' THEN now() ELSE NULL END,
        CASE WHEN p_outcome_type IN ('RTO', 'RETURNED', 'REFUSED') THEN now() ELSE NULL END,
        now()
      )
      ON CONFLICT (phone_normalized) DO UPDATE
      SET successful_prepaid_deliveries = CASE WHEN p_outcome_type = 'DELIVERED' THEN public.cod_risk_profiles.successful_prepaid_deliveries + 1 ELSE public.cod_risk_profiles.successful_prepaid_deliveries END,
          rto_count = CASE WHEN p_outcome_type IN ('RTO', 'RETURNED') THEN public.cod_risk_profiles.rto_count + 1 ELSE public.cod_risk_profiles.rto_count END,
          refused_count = CASE WHEN p_outcome_type = 'REFUSED' THEN public.cod_risk_profiles.refused_count + 1 ELSE public.cod_risk_profiles.refused_count END,
          last_successful_delivery_at = CASE WHEN p_outcome_type = 'DELIVERED' THEN now() ELSE public.cod_risk_profiles.last_successful_delivery_at END,
          last_rto_at = CASE WHEN p_outcome_type IN ('RTO', 'RETURNED', 'REFUSED') THEN now() ELSE public.cod_risk_profiles.last_rto_at END,
          updated_at = now();
    END IF;

    -- Recompute Risk Classification & Exact Score Parity in DB (Requirement #19)
    SELECT * INTO v_prof FROM public.cod_risk_profiles WHERE phone_normalized = v_phone;
    v_rto_cnt := COALESCE(v_prof.rto_count, 0);
    v_refused_cnt := COALESCE(v_prof.refused_count, 0);
    v_cod_succ := COALESCE(v_prof.successful_cod_deliveries, 0);

    IF v_rto_cnt >= 2 OR v_prof.prepaid_only THEN
      v_band := 'PREPAID_ONLY';
      v_score := 90;
      v_prepaid_only := TRUE;
    ELSIF v_cod_succ >= 2 AND v_rto_cnt = 0 THEN
      v_band := 'TRUSTED_REPEAT';
      v_score := 10;
      v_prepaid_only := FALSE;
    ELSIF v_rto_cnt > 0 OR v_refused_cnt > 0 THEN
      v_band := 'HIGH_RISK';
      v_score := 70;
      v_prepaid_only := FALSE;
    ELSE
      v_band := 'NEW_CUSTOMER';
      v_score := 30;
      v_prepaid_only := FALSE;
    END IF;

    UPDATE public.cod_risk_profiles
    SET risk_band = v_band,
        risk_score = v_score,
        prepaid_only = v_prepaid_only,
        is_cod_eligible = NOT v_prepaid_only,
        updated_at = now()
    WHERE phone_normalized = v_phone;
  END IF;

  RETURN jsonb_build_object('ok', true, 'alreadyProcessed', false, 'fulfillment_id', p_fulfillment_id);
END;
$$;

-- 22. Atomic SECURITY DEFINER RPC: reserve_matching_returned_inventory_with_audit
CREATE OR REPLACE FUNCTION public.reserve_matching_returned_inventory_with_audit(
  p_order_item_id UUID,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_item RECORD;
  v_order RECORD;
  v_inv RECORD;
  v_mfg_hash TEXT;
BEGIN
  -- Lock order item FOR UPDATE
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_item_not_found');
  END IF;

  v_mfg_hash := v_item.manufacturing_identity_hash;
  IF v_mfg_hash IS NULL OR trim(v_mfg_hash) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_item_missing_manufacturing_identity_hash');
  END IF;

  -- Lock replacement order FOR UPDATE
  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'replacement_order_not_found');
  END IF;

  -- Verify replacement order payment gate (Requirement #18: Authoritative Payment Proof for Prepaid Replacement)
  IF v_order.payment_method = 'cod' THEN
    IF COALESCE(v_order.cod_status, 'NOT_COD') <> 'COD_APPROVED' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'replacement_cod_order_not_approved');
    END IF;
  ELSE
    IF COALESCE(v_order.payment_status, 'unpaid') <> 'captured' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'replacement_prepaid_order_unpaid');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE order_id = v_order.id
        AND status = 'captured'
        AND amount_paise = v_order.total_paise
        AND currency = COALESCE(v_order.currency, 'INR')
        AND (v_order.payment_provider IS NULL OR provider = v_order.payment_provider)
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'replacement_prepaid_payment_proof_missing');
    END IF;
  END IF;

  -- Select matching REUSABLE inventory item with FOR UPDATE SKIP LOCKED
  SELECT * INTO v_inv
  FROM public.returned_inventory
  WHERE reuse_status = 'REUSABLE'
    AND reuse_eligible = true
    AND manufacturing_identity_hash = v_mfg_hash
  ORDER BY received_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_matching_returned_inventory_available');
  END IF;

  UPDATE public.returned_inventory
  SET reuse_status = 'RESERVED',
      replacement_order_id = v_order.id,
      updated_at = now()
  WHERE id = v_inv.id;

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json, created_at)
  VALUES (
    p_admin_id,
    'RESERVE_RETURNED_INVENTORY',
    'RETURNED_INVENTORY',
    v_inv.id::text,
    jsonb_build_object(
      'replacement_order_id', v_order.id,
      'order_item_id', p_order_item_id,
      'manufacturing_hash', v_mfg_hash
    ),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'reserved_item_id', v_inv.id, 'replacement_order_id', v_order.id);
END;
$$;

-- 23. Revoke SECURITY DEFINER execution privileges from PUBLIC/anon/authenticated and grant to service_role ONLY
REVOKE EXECUTE ON FUNCTION public.normalize_phone(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_valid_cod_status_transition(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_cod_decision_with_audit(TEXT, TEXT, TEXT, BOOLEAN, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.override_cod_status_with_audit(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_cod_otp_challenge_with_audit(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_cod_otp_challenge_sent(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_cod_otp_challenge_failed(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_cod_otp_and_apply_decision_with_audit(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.capture_cod_advance_with_audit(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_cod_advance_checkout_with_audit(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_cod_advance_creation_unknown_with_audit(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bind_cod_advance_provider_order_with_audit(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_returned_inventory_with_audit(UUID, TEXT, UUID, UUID, UUID, UUID, UUID, INT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_matching_returned_inventory_with_audit(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_delivery_outcome_with_audit(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.normalize_phone(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_cod_status_transition(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_cod_decision_with_audit(TEXT, TEXT, TEXT, BOOLEAN, BIGINT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.override_cod_status_with_audit(TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_cod_otp_challenge_with_audit(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_cod_otp_challenge_sent(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_cod_otp_challenge_failed(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_cod_otp_and_apply_decision_with_audit(TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_cod_advance_with_audit(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_cod_advance_checkout_with_audit(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_cod_advance_creation_unknown_with_audit(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_cod_advance_provider_order_with_audit(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_returned_inventory_with_audit(UUID, TEXT, UUID, UUID, UUID, UUID, UUID, INT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_matching_returned_inventory_with_audit(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_delivery_outcome_with_audit(UUID, TEXT, TEXT, JSONB) TO service_role;
