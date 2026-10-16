-- =============================================================================
-- ASCEND THEORY PLATFORM — ADDITIVE MIGRATION (PHASE 6 QIKINK FULFILMENT INTEGRATION)
-- Migration: 20260809000007_qikink_fulfilment.sql
-- Description: Extends orders, fulfillments, fulfillment_events, and shipments tables.
--              Adds canonical status constraint, payment_method column, multi-item snapshot fields,
--              idempotency tracking, request hash verification, atomic retry claim RPC,
--              atomic submission failure RPC, status transition graph parity, and race-safe waybill binding.
-- =============================================================================

-- 1. Extend orders table to durably persist payment_method & payment_provider
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IN ('online', 'cod')),
  ADD COLUMN IF NOT EXISTS payment_provider TEXT;

-- 2. Extend fulfillments table with operational & provider tracking columns
ALTER TABLE public.fulfillments
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS request_hash TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_code TEXT,
  ADD COLUMN IF NOT EXISTS failure_message TEXT,
  ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_json JSONB DEFAULT '{}'::jsonb;

-- 3. Fix Live Fulfilment Status Constraint (Requirement #1)
ALTER TABLE public.fulfillments DROP CONSTRAINT IF EXISTS fulfillments_status_check;

-- Safely migrate legacy rows if any exist
UPDATE public.fulfillments SET status = 'READY' WHERE status = 'pending';
UPDATE public.fulfillments SET status = 'PROCESSING' WHERE status = 'processing';
UPDATE public.fulfillments SET status = 'IN_TRANSIT' WHERE status = 'shipped';
UPDATE public.fulfillments SET status = 'DELIVERED' WHERE status = 'delivered';
UPDATE public.fulfillments SET status = 'FAILED' WHERE status = 'failed';
UPDATE public.fulfillments SET status = 'RETURNED' WHERE status = 'returned';

ALTER TABLE public.fulfillments
  ADD CONSTRAINT fulfillments_status_check CHECK (
    status IN (
      'READY',
      'QUEUED',
      'SUBMITTING',
      'SUBMITTED',
      'PROCESSING',
      'ACTION_REQUIRED',
      'OUT_OF_STOCK',
      'PRINTED',
      'MANIFESTED',
      'IN_TRANSIT',
      'DELIVERED',
      'EXCEPTION',
      'RTO_INITIATED',
      'RETURNED',
      'CANCELLED',
      'FAILED',
      'RECONCILIATION_REQUIRED',
      'UNKNOWN_PROVIDER_STATE'
    )
  );

ALTER TABLE public.fulfillments ALTER COLUMN status SET DEFAULT 'READY';

-- Provider-scoped partial unique index on provider_order_id (Requirement #26)
DROP INDEX IF EXISTS public.idx_unique_fulfillments_provider_order_id;
CREATE UNIQUE INDEX idx_unique_fulfillments_provider_order_id
  ON public.fulfillments (provider_id, provider_order_id)
  WHERE (provider_order_id IS NOT NULL);

-- Unique index on idempotency_key for deterministic idempotency (Requirement #11)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_fulfillments_idempotency_key
  ON public.fulfillments (idempotency_key)
  WHERE (idempotency_key IS NOT NULL);

-- Partial unique index to enforce single active fulfillment per order & provider (Requirement #1)
DROP INDEX IF EXISTS public.idx_unique_fulfillments_order_provider_active;
CREATE UNIQUE INDEX idx_unique_fulfillments_order_provider_active
  ON public.fulfillments (order_id, provider_id)
  WHERE (status NOT IN ('FAILED', 'CANCELLED'));

-- 4. Extend fulfillment_events table
ALTER TABLE public.fulfillment_events
  ADD COLUMN IF NOT EXISTS details_json JSONB DEFAULT '{}'::jsonb;

-- 5. Extend shipments table (Requirement #24)
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES public.pod_providers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS courier_code TEXT,
  ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_fulfillments_order_id ON public.fulfillments(order_id);
CREATE INDEX IF NOT EXISTS idx_fulfillments_provider_id ON public.fulfillments(provider_id);
CREATE INDEX IF NOT EXISTS idx_fulfillments_status ON public.fulfillments(status);
CREATE INDEX IF NOT EXISTS idx_fulfillments_provider_order_id ON public.fulfillments(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_events_fulfillment_id ON public.fulfillment_events(fulfillment_id);
CREATE INDEX IF NOT EXISTS idx_shipments_fulfillment_id ON public.shipments(fulfillment_id);

-- 6. PRIVILEGE & RLS LOCKDOWN FOR FULFILMENT TABLES

REVOKE ALL ON public.fulfillments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fulfillment_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.shipments FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.fulfillments TO service_role;
GRANT ALL ON public.fulfillment_events TO service_role;
GRANT ALL ON public.shipments TO service_role;

ALTER TABLE public.fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

-- Admin RLS Policies for authenticated staff (Requirement #5: owner, admin, support ONLY - remove editor)
DROP POLICY IF EXISTS "Admin read fulfillments" ON public.fulfillments;
CREATE POLICY "Admin read fulfillments" ON public.fulfillments
  FOR SELECT TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'support']));

DROP POLICY IF EXISTS "Admin write fulfillments" ON public.fulfillments;
CREATE POLICY "Admin write fulfillments" ON public.fulfillments
  FOR ALL TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admin read fulfillment_events" ON public.fulfillment_events;
CREATE POLICY "Admin read fulfillment_events" ON public.fulfillment_events
  FOR SELECT TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'support']));

DROP POLICY IF EXISTS "Admin write fulfillment_events" ON public.fulfillment_events;
CREATE POLICY "Admin write fulfillment_events" ON public.fulfillment_events
  FOR ALL TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admin read shipments" ON public.shipments;
CREATE POLICY "Admin read shipments" ON public.shipments
  FOR SELECT TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin', 'support']));

DROP POLICY IF EXISTS "Admin write shipments" ON public.shipments;
CREATE POLICY "Admin write shipments" ON public.shipments
  FOR ALL TO authenticated
  USING (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']))
  WITH CHECK (public.is_caller_active_admin_with_roles(ARRAY['owner', 'admin']));

-- 7. STATUS TRANSITION GRAPH VALIDATION HELPER (Requirement #1: Exact 1-to-1 TS Graph Parity)
CREATE OR REPLACE FUNCTION public.is_valid_fulfillment_status_transition(
  p_current_status TEXT,
  p_next_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_current_status = p_next_status THEN
    RETURN true;
  END IF;

  -- Terminal states cannot transition to anything
  IF p_current_status IN ('DELIVERED', 'RETURNED', 'CANCELLED') THEN
    RETURN false;
  END IF;

  CASE p_current_status
    WHEN 'READY' THEN
      RETURN p_next_status IN ('SUBMITTING', 'CANCELLED');
    WHEN 'QUEUED' THEN
      RETURN p_next_status IN ('SUBMITTING', 'CANCELLED');
    WHEN 'SUBMITTING' THEN
      RETURN p_next_status IN ('SUBMITTED', 'PROCESSING', 'QUEUED', 'FAILED', 'RECONCILIATION_REQUIRED', 'ACTION_REQUIRED', 'OUT_OF_STOCK', 'UNKNOWN_PROVIDER_STATE');
    WHEN 'SUBMITTED' THEN
      RETURN p_next_status IN ('PROCESSING', 'MANIFESTED', 'IN_TRANSIT', 'ACTION_REQUIRED', 'OUT_OF_STOCK', 'EXCEPTION', 'UNKNOWN_PROVIDER_STATE');
    WHEN 'PROCESSING' THEN
      RETURN p_next_status IN ('PRINTED', 'MANIFESTED', 'IN_TRANSIT', 'ACTION_REQUIRED', 'OUT_OF_STOCK', 'EXCEPTION', 'FAILED', 'UNKNOWN_PROVIDER_STATE');
    WHEN 'PRINTED' THEN
      RETURN p_next_status IN ('MANIFESTED', 'IN_TRANSIT', 'EXCEPTION');
    WHEN 'MANIFESTED' THEN
      RETURN p_next_status IN ('IN_TRANSIT', 'EXCEPTION');
    WHEN 'IN_TRANSIT' THEN
      RETURN p_next_status IN ('DELIVERED', 'RTO_INITIATED', 'EXCEPTION');
    WHEN 'RTO_INITIATED' THEN
      RETURN p_next_status IN ('RETURNED');
    WHEN 'ACTION_REQUIRED' THEN
      RETURN p_next_status IN ('PROCESSING', 'FAILED', 'CANCELLED', 'UNKNOWN_PROVIDER_STATE');
    WHEN 'OUT_OF_STOCK' THEN
      RETURN p_next_status IN ('PROCESSING', 'FAILED', 'CANCELLED');
    WHEN 'UNKNOWN_PROVIDER_STATE' THEN
      RETURN p_next_status IN ('PROCESSING', 'ACTION_REQUIRED', 'OUT_OF_STOCK', 'MANIFESTED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED');
    WHEN 'RECONCILIATION_REQUIRED' THEN
      RETURN p_next_status IN ('PROCESSING', 'SUBMITTED', 'ACTION_REQUIRED', 'OUT_OF_STOCK', 'FAILED', 'CANCELLED', 'UNKNOWN_PROVIDER_STATE');
    WHEN 'EXCEPTION' THEN
      RETURN p_next_status IN ('IN_TRANSIT', 'DELIVERED', 'RTO_INITIATED', 'RETURNED', 'CANCELLED', 'FAILED');
    WHEN 'FAILED' THEN
      RETURN false;
    ELSE
      RETURN false;
  END CASE;
END;
$$;

-- 8. SECURITY DEFINER TRANSACTIONAL RPCs

-- 8a. Atomic Race-Safe Initial Claim RPC (Requirements #3, #4)
CREATE OR REPLACE FUNCTION public.create_or_claim_fulfillment_with_audit(
  p_fulfillment_id UUID,
  p_order_id TEXT,
  p_provider_id UUID,
  p_idempotency_key TEXT,
  p_request_hash TEXT,
  p_provider_reference TEXT,
  p_snapshot_json JSONB,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_existing_status TEXT;
  v_existing_prov_order_id TEXT;
  v_existing_hash TEXT;
BEGIN
  -- Check existing fulfillment by idempotency key
  SELECT id, status, provider_order_id, request_hash
    INTO v_existing_id, v_existing_status, v_existing_prov_order_id, v_existing_hash
    FROM public.fulfillments
   WHERE idempotency_key = p_idempotency_key
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Requirement #4: Controlled manual review result for FAILED fulfillment
    IF v_existing_status IN ('FAILED') AND v_existing_prov_order_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'failed_fulfillment_requires_manual_review', 'fulfillment_id', v_existing_id);
    END IF;

    IF v_existing_hash IS NOT NULL AND p_request_hash IS NOT NULL AND v_existing_hash != p_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_payload_mismatch', 'fulfillment_id', v_existing_id);
    END IF;

    IF v_existing_status IN ('SUBMITTING') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_claimed', 'fulfillment_id', v_existing_id);
    ELSIF v_existing_status IN ('SUBMITTED', 'PROCESSING', 'MANIFESTED', 'IN_TRANSIT', 'DELIVERED') OR v_existing_prov_order_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_submitted', 'fulfillment_id', v_existing_id, 'provider_order_id', v_existing_prov_order_id);
    END IF;
  END IF;

  -- Check existing active fulfillment for order/provider
  SELECT id, status, provider_order_id, request_hash
    INTO v_existing_id, v_existing_status, v_existing_prov_order_id, v_existing_hash
    FROM public.fulfillments
   WHERE order_id = p_order_id AND provider_id = p_provider_id AND status NOT IN ('FAILED', 'CANCELLED')
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status IN ('FAILED') AND v_existing_prov_order_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'failed_fulfillment_requires_manual_review', 'fulfillment_id', v_existing_id);
    END IF;

    IF v_existing_hash IS NOT NULL AND p_request_hash IS NOT NULL AND v_existing_hash != p_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_payload_mismatch', 'fulfillment_id', v_existing_id);
    ELSIF v_existing_status IN ('SUBMITTING') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_claimed', 'fulfillment_id', v_existing_id);
    ELSIF v_existing_status IN ('SUBMITTED', 'PROCESSING', 'MANIFESTED', 'IN_TRANSIT', 'DELIVERED') OR v_existing_prov_order_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_submitted', 'fulfillment_id', v_existing_id, 'provider_order_id', v_existing_prov_order_id);
    END IF;
  END IF;

  -- Insert new claim
  INSERT INTO public.fulfillments (
    id, order_id, provider_id, status, provider_reference,
    idempotency_key, request_hash, attempt_count, retryable, max_attempts,
    snapshot_json, created_at, updated_at
  )
  VALUES (
    p_fulfillment_id,
    p_order_id,
    p_provider_id,
    'SUBMITTING',
    p_provider_reference,
    p_idempotency_key,
    p_request_hash,
    1,
    true,
    3,
    p_snapshot_json,
    now(),
    now()
  );

  INSERT INTO public.fulfillment_events (fulfillment_id, event_type, description, details_json)
  VALUES (
    p_fulfillment_id,
    'SUBMISSION_CLAIMED',
    'Claimed fulfillment submission lock',
    jsonb_build_object('admin_id', p_admin_id, 'idempotency_key', p_idempotency_key, 'actor_type', CASE WHEN p_admin_id IS NULL THEN 'system' ELSE 'admin' END)
  );

  IF p_admin_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
    VALUES (
      p_admin_id,
      'fulfillment_claimed',
      'fulfillment',
      p_fulfillment_id::TEXT,
      jsonb_build_object('order_id', p_order_id, 'provider_id', p_provider_id)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'fulfillment_id', p_fulfillment_id);
EXCEPTION WHEN unique_violation THEN
  -- Concurrency race condition protection
  SELECT id, status, provider_order_id, request_hash
    INTO v_existing_id, v_existing_status, v_existing_prov_order_id, v_existing_hash
    FROM public.fulfillments
   WHERE idempotency_key = p_idempotency_key OR (order_id = p_order_id AND provider_id = p_provider_id AND status NOT IN ('FAILED', 'CANCELLED'))
   LIMIT 1;

  IF v_existing_status IN ('FAILED') AND v_existing_prov_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'failed_fulfillment_requires_manual_review', 'fulfillment_id', v_existing_id);
  ELSIF v_existing_hash IS NOT NULL AND p_request_hash IS NOT NULL AND v_existing_hash != p_request_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'idempotency_payload_mismatch', 'fulfillment_id', v_existing_id);
  ELSIF v_existing_status IN ('SUBMITTING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_claimed', 'fulfillment_id', v_existing_id);
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'already_submitted', 'fulfillment_id', v_existing_id, 'provider_order_id', v_existing_prov_order_id);
  END IF;
WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_claim_fulfillment_with_audit(UUID, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_claim_fulfillment_with_audit(UUID, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, UUID) TO service_role;

-- 8b. Atomic Retry Claim RPC (Requirement #1)
CREATE OR REPLACE FUNCTION public.claim_fulfillment_retry_with_audit(
  p_fulfillment_id UUID,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_prov_order_id TEXT;
  v_attempt_count INT;
  v_max_attempts INT;
  v_retryable BOOLEAN;
  v_next_retry_at TIMESTAMPTZ;
BEGIN
  SELECT status, provider_order_id, attempt_count, max_attempts, retryable, next_retry_at
    INTO v_status, v_prov_order_id, v_attempt_count, v_max_attempts, v_retryable, v_next_retry_at
    FROM public.fulfillments
   WHERE id = p_fulfillment_id
     FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fulfillment not found');
  END IF;

  IF v_prov_order_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_submitted', 'provider_order_id', v_prov_order_id);
  END IF;

  -- Exact state check: SUBMITTING is already claimed by another worker
  IF v_status = 'SUBMITTING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_claimed');
  END IF;

  IF v_status = 'RECONCILIATION_REQUIRED' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reconciliation_required');
  END IF;

  -- Requirement #1: Retry state must be EXACTLY QUEUED
  IF v_status != 'QUEUED' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_retry_state', 'status', v_status);
  END IF;

  IF NOT COALESCE(v_retryable, true) OR v_attempt_count >= COALESCE(v_max_attempts, 3) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'retry_exhausted', 'attempt_count', v_attempt_count);
  END IF;

  IF v_next_retry_at IS NOT NULL AND v_next_retry_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'retry_not_ready', 'next_retry_at', v_next_retry_at);
  END IF;

  UPDATE public.fulfillments
     SET status = 'SUBMITTING',
         attempt_count = attempt_count + 1,
         updated_at = now()
   WHERE id = p_fulfillment_id;

  INSERT INTO public.fulfillment_events (fulfillment_id, event_type, description, details_json)
  VALUES (
    p_fulfillment_id,
    'RETRY_CLAIMED',
    format('Claimed retry attempt #%s', v_attempt_count + 1),
    jsonb_build_object('admin_id', p_admin_id, 'attempt_count', v_attempt_count + 1, 'actor_type', CASE WHEN p_admin_id IS NULL THEN 'system' ELSE 'admin' END)
  );

  IF p_admin_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
    VALUES (
      p_admin_id,
      'fulfillment_retry_claimed',
      'fulfillment',
      p_fulfillment_id::TEXT,
      jsonb_build_object('attempt_count', v_attempt_count + 1)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'fulfillment_id', p_fulfillment_id, 'attempt_count', v_attempt_count + 1);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_fulfillment_retry_with_audit(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fulfillment_retry_with_audit(UUID, UUID) TO service_role;

-- 8c. Atomic Provider Order Submission Failure RPC (Requirement #9)
CREATE OR REPLACE FUNCTION public.record_fulfillment_submission_failure_with_audit(
  p_fulfillment_id UUID,
  p_next_status TEXT,
  p_provider_status TEXT DEFAULT NULL,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL,
  p_retryable BOOLEAN DEFAULT false,
  p_next_retry_at TIMESTAMPTZ DEFAULT NULL,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
BEGIN
  SELECT status INTO v_current_status
    FROM public.fulfillments WHERE id = p_fulfillment_id FOR UPDATE;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fulfillment not found');
  END IF;

  IF v_current_status != 'SUBMITTING' THEN
    RETURN jsonb_build_object('ok', false, 'error', format('invalid_submission_state: current status is %s', v_current_status));
  END IF;

  IF NOT public.is_valid_fulfillment_status_transition(v_current_status, p_next_status) THEN
    RETURN jsonb_build_object('ok', false, 'error', format('invalid_status_transition: cannot move from %s to %s', v_current_status, p_next_status));
  END IF;

  UPDATE public.fulfillments
     SET status = p_next_status,
         provider_status = COALESCE(p_provider_status, provider_status),
         failure_code = COALESCE(p_failure_code, failure_code),
         failure_message = COALESCE(p_failure_message, failure_message),
         retryable = p_retryable,
         next_retry_at = p_next_retry_at,
         failed_at = CASE WHEN p_next_status IN ('FAILED') THEN COALESCE(failed_at, now()) ELSE failed_at END,
         last_synced_at = now(),
         updated_at = now()
   WHERE id = p_fulfillment_id;

  INSERT INTO public.fulfillment_events (fulfillment_id, event_type, description, details_json)
  VALUES (
    p_fulfillment_id,
    CASE WHEN p_next_status = 'QUEUED' THEN 'SUBMISSION_QUEUED' ELSE 'SUBMISSION_FAILED' END,
    format('Fulfillment submission failed (%s): %s', COALESCE(p_failure_code, 'UNKNOWN'), COALESCE(p_failure_message, 'No message')),
    jsonb_build_object('provider_status', p_provider_status, 'failure_code', p_failure_code, 'retryable', p_retryable, 'next_retry_at', p_next_retry_at)
  );

  IF p_admin_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
    VALUES (
      p_admin_id,
      'fulfillment_submission_failed',
      'fulfillment',
      p_fulfillment_id::TEXT,
      jsonb_build_object('next_status', p_next_status, 'failure_code', p_failure_code)
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.record_fulfillment_submission_failure_with_audit(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_fulfillment_submission_failure_with_audit(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, UUID) TO service_role;

-- 8d. Atomic Provider Order Binding RPC
CREATE OR REPLACE FUNCTION public.bind_provider_order_with_audit(
  p_fulfillment_id UUID,
  p_provider_order_id TEXT,
  p_provider_status TEXT,
  p_normalized_status TEXT,
  p_metadata_json JSONB,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider_id UUID;
  v_existing_prov_order_id TEXT;
  v_bound_to_other_id UUID;
  v_current_status TEXT;
BEGIN
  SELECT provider_id, provider_order_id, status
    INTO v_provider_id, v_existing_prov_order_id, v_current_status
    FROM public.fulfillments WHERE id = p_fulfillment_id FOR UPDATE;

  IF v_existing_prov_order_id IS NOT NULL AND v_existing_prov_order_id != p_provider_order_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_order_rebound');
  END IF;

  IF NOT public.is_valid_fulfillment_status_transition(v_current_status, p_normalized_status) THEN
    RETURN jsonb_build_object('ok', false, 'error', format('invalid_status_transition: cannot move from %s to %s', v_current_status, p_normalized_status));
  END IF;

  -- Verify provider-scoped uniqueness
  IF v_provider_id IS NOT NULL THEN
    SELECT id INTO v_bound_to_other_id
      FROM public.fulfillments
     WHERE provider_id = v_provider_id
       AND provider_order_id = p_provider_order_id
       AND id != p_fulfillment_id
     LIMIT 1;

    IF v_bound_to_other_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'provider_order_rebound');
    END IF;
  END IF;

  UPDATE public.fulfillments
     SET provider_order_id = p_provider_order_id,
         provider_status = p_provider_status,
         status = p_normalized_status,
         submitted_at = COALESCE(submitted_at, now()),
         last_synced_at = now(),
         metadata_json = COALESCE(metadata_json, '{}'::jsonb) || p_metadata_json,
         updated_at = now()
   WHERE id = p_fulfillment_id;

  INSERT INTO public.fulfillment_events (fulfillment_id, event_type, description, details_json)
  VALUES (
    p_fulfillment_id,
    'PROVIDER_ORDER_BOUND',
    format('Bound provider order ID %s with status %s', p_provider_order_id, p_normalized_status),
    p_metadata_json
  );

  IF p_admin_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details_json)
    VALUES (
      p_admin_id,
      'provider_order_bound',
      'fulfillment',
      p_fulfillment_id::TEXT,
      jsonb_build_object('provider_order_id', p_provider_order_id, 'status', p_normalized_status)
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.bind_provider_order_with_audit(UUID, TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_provider_order_with_audit(UUID, TEXT, TEXT, TEXT, JSONB, UUID) TO service_role;

-- 8e. Atomic Fulfillment Event & Controlled Status Update RPC (Requirement #2: Race-Safe Waybill Binding)
CREATE OR REPLACE FUNCTION public.update_fulfillment_status_with_audit(
  p_fulfillment_id UUID,
  p_status TEXT,
  p_provider_status TEXT DEFAULT NULL,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL,
  p_tracking_number TEXT DEFAULT NULL,
  p_courier_name TEXT DEFAULT NULL,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
  v_existing_shipment_ful_id UUID;
BEGIN
  SELECT status INTO v_current_status
    FROM public.fulfillments WHERE id = p_fulfillment_id FOR UPDATE;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fulfillment not found');
  END IF;

  -- Controlled status transition enforcement (Requirement #1 / #8)
  IF NOT public.is_valid_fulfillment_status_transition(v_current_status, p_status) THEN
    RETURN jsonb_build_object('ok', false, 'error', format('invalid_status_transition: cannot move from %s to %s', v_current_status, p_status));
  END IF;

  -- Waybill rebound protection & race safety (Requirement #2)
  IF p_tracking_number IS NOT NULL AND p_tracking_number != '' THEN
    INSERT INTO public.shipments (fulfillment_id, waybill_number, dispatched_at, created_at)
    VALUES (p_fulfillment_id, p_tracking_number, now(), now())
    ON CONFLICT (waybill_number) DO NOTHING;

    SELECT fulfillment_id INTO v_existing_shipment_ful_id
      FROM public.shipments
     WHERE waybill_number = p_tracking_number
     FOR UPDATE;

    IF v_existing_shipment_ful_id IS NOT NULL AND v_existing_shipment_ful_id != p_fulfillment_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'shipment_waybill_rebound');
    END IF;
  END IF;

  UPDATE public.fulfillments
     SET status = p_status,
         provider_status = COALESCE(p_provider_status, provider_status),
         failure_code = COALESCE(p_failure_code, failure_code),
         failure_message = COALESCE(p_failure_message, failure_message),
         tracking_number = COALESCE(p_tracking_number, tracking_number),
         courier_name = COALESCE(p_courier_name, courier_name),
         failed_at = CASE WHEN p_status IN ('FAILED') THEN COALESCE(failed_at, now()) ELSE failed_at END,
         last_synced_at = now(),
         updated_at = now()
   WHERE id = p_fulfillment_id;

  INSERT INTO public.fulfillment_events (fulfillment_id, event_type, description, details_json)
  VALUES (
    p_fulfillment_id,
    format('STATUS_%s', UPPER(p_status)),
    format('Fulfillment status set to %s', p_status),
    jsonb_build_object('provider_status', p_provider_status, 'failure_code', p_failure_code, 'tracking_number', p_tracking_number)
  );

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.update_fulfillment_status_with_audit(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_fulfillment_status_with_audit(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;
