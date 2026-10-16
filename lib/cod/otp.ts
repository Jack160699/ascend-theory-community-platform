/**
 * Phase 7 — Authoritative COD OTP Verification & Pepper Manager (Requirements #8, #9, #10, #11, #12, #13, #14)
 * Hardens OTP security with HMAC-SHA256 pepper, durable resend throttling (60s limit),
 * transport error handling, and single-transaction verification & COD status application.
 */

import crypto from "node:crypto";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getOTPTransportProvider } from "./otp-transport";
import type { CodOtpChallenge } from "./types";

const memoryOtpChallenges = new Map<string, CodOtpChallenge & { phoneNormalized: string }>();

/**
 * Deterministic Phone Normalization matching SQL public.normalize_phone() exactly (Requirement #8).
 */
export function normalizePhone(phone: string): string {
  if (!phone || !phone.trim()) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  return "";
}

/**
 * Obtains active pepper with fail-closed production gate (Requirement #9).
 */
export function getOtpPepper(): { pepper?: string; error?: string } {
  const envPepper = process.env.COD_OTP_PEPPER;
  if (envPepper && envPepper.trim()) {
    return { pepper: envPepper.trim() };
  }
  if (process.env.NODE_ENV === "test") {
    return { pepper: "test_only_otp_pepper_secret_2026" };
  }
  return { error: "otp_pepper_unconfigured" };
}

export function hashOtp(otpText: string, pepper: string): string {
  return crypto.createHmac("sha256", pepper).update(otpText).digest("hex");
}

export function generateRandomNumericOtp(length: number = 6): string {
  const bytes = crypto.randomBytes(length);
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += (bytes[i]! % 10).toString();
  }
  return otp;
}

export async function createOtpChallengeAdmin(
  orderId: string,
  rawPhone: string,
  tokenHash?: string,
): Promise<{ ok: true; otpText: string; challengeId: string } | { ok: false; error: string }> {
  const phoneNorm = normalizePhone(rawPhone);
  if (!phoneNorm) {
    return { ok: false, error: "invalid_phone_number" };
  }

  const pepperRes = getOtpPepper();
  if (pepperRes.error || !pepperRes.pepper) {
    return { ok: false, error: pepperRes.error || "otp_pepper_unconfigured" };
  }

  const otpText = generateRandomNumericOtp(6);
  const otpHash = hashOtp(otpText, pepperRes.pepper);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  let challengeId = `chal-${Date.now()}`;

  if (hasSupabaseConfig()) {
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      return { ok: false, error: "Supabase service client unconfigured" };
    }

    const { data: rpcRes, error: rpcErr } = await supabase.rpc("create_cod_otp_challenge_with_audit", {
      p_order_id: orderId,
      p_token_hash: tokenHash || "",
      p_phone_normalized: phoneNorm,
      p_otp_hash: otpHash,
      p_expires_at: expiresAt,
    });

    if (rpcErr || !rpcRes || !(rpcRes as { ok?: boolean }).ok) {
      const errStr = (rpcRes as { error?: string })?.error || rpcErr?.message || "Failed to create OTP challenge";
      return { ok: false, error: errStr };
    }

    challengeId = (rpcRes as { challenge_id: string }).challenge_id;

    // Send via transport
    const transportProvider = getOTPTransportProvider();
    const transportRes = await transportProvider.sendOtp(phoneNorm, otpText);
    if (!transportRes.success) {
      // Mark challenge failed atomically
      await supabase.rpc("mark_cod_otp_challenge_failed", { p_challenge_id: challengeId });
      return { ok: false, error: `otp_transport_delivery_failed: ${transportRes.error || "Delivery failed"}` };
    }

    // Mark challenge sent atomically (Requirement #1)
    const { data: sentRes, error: sentErr } = await supabase.rpc("mark_cod_otp_challenge_sent", {
      p_challenge_id: challengeId,
    });
    if (sentErr || !sentRes || !(sentRes as { ok?: boolean }).ok) {
      await supabase.rpc("mark_cod_otp_challenge_failed", { p_challenge_id: challengeId });
      const errStr = (sentRes as { error?: string })?.error || sentErr?.message || "Failed to mark challenge sent";
      return { ok: false, error: `otp_sent_status_failed: ${errStr}` };
    }
  } else {
    // Memory fallback with 60s cooldown & resend throttling
    const existing = memoryOtpChallenges.get(orderId);
    if (existing && !existing.consumedAt) {
      const sentMs = new Date(existing.createdAt).getTime();
      if (Date.now() - sentMs < 60 * 1000) {
        return { ok: false, error: "otp_resend_cooldown_active" };
      }
      if ((existing.resendCount ?? 0) >= 3) {
        return { ok: false, error: "otp_max_resends_exceeded" };
      }
    }

    const resendCount = (existing?.resendCount || 0) + 1;
    const challenge: CodOtpChallenge = {
      id: challengeId,
      orderId,
      phoneNormalized: phoneNorm,
      otpHash,
      expiresAt,
      attemptCount: 0,
      maxAttempts: 3,
      resendCount,
      deliveryStatus: "sent",
      createdAt: new Date().toISOString(),
    };
    memoryOtpChallenges.set(orderId, challenge);
  }

  return { ok: true, otpText, challengeId };
}

/**
 * Single-Transaction OTP Verification & Authoritative Decision Application (Requirement #13 & #14)
 */
export async function verifyOtpChallengeAndApplyDecisionAdmin(
  orderId: string,
  tokenHash: string,
  submittedOtpText: string,
  adminId?: string | null,
): Promise<{ ok: true; targetStatus: string; advanceRequired?: boolean } | { ok: false; error: string; remainingAttempts?: number }> {
  if (!tokenHash || !tokenHash.trim()) {
    return { ok: false, error: "missing_confirmation_token_hash" };
  }

  const pepperRes = getOtpPepper();
  if (pepperRes.error || !pepperRes.pepper) {
    return { ok: false, error: pepperRes.error || "otp_pepper_unconfigured" };
  }

  const submittedOtpHash = hashOtp(submittedOtpText, pepperRes.pepper);

  if (hasSupabaseConfig()) {
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      return { ok: false, error: "Supabase service client unconfigured" };
    }

    const { data: rpcRes, error: rpcErr } = await supabase.rpc("verify_cod_otp_and_apply_decision_with_audit", {
      p_order_id: orderId,
      p_token_hash: tokenHash,
      p_submitted_otp_hash: submittedOtpHash,
      p_admin_id: adminId || null,
    });

    if (rpcErr || !rpcRes || !(rpcRes as { ok?: boolean }).ok) {
      const errStr = (rpcRes as { error?: string })?.error || rpcErr?.message || "Verification failed";
      const remainingAttempts = (rpcRes as { remaining_attempts?: number })?.remaining_attempts;
      return { ok: false, error: errStr, remainingAttempts };
    }

    const targetStatus = (rpcRes as { cod_status: string }).cod_status;
    const advanceRequired = (rpcRes as { advance_required?: boolean }).advance_required;
    return { ok: true, targetStatus, advanceRequired };
  }

  // Memory fallback for dev/testing
  const challenge = memoryOtpChallenges.get(orderId);
  if (!challenge) {
    return { ok: false, error: "no_active_otp_challenge" };
  }

  if (challenge.consumedAt) {
    return { ok: false, error: "otp_already_consumed" };
  }

  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: "otp_expired" };
  }

  if (challenge.attemptCount >= challenge.maxAttempts) {
    return { ok: false, error: "otp_max_attempts_exceeded" };
  }

  if (challenge.otpHash !== submittedOtpHash) {
    challenge.attemptCount += 1;
    memoryOtpChallenges.set(orderId, challenge);
    return { ok: false, error: "invalid_otp", remainingAttempts: challenge.maxAttempts - challenge.attemptCount };
  }

  challenge.consumedAt = new Date().toISOString();
  challenge.verifiedAt = new Date().toISOString();
  memoryOtpChallenges.set(orderId, challenge);

  return { ok: true, targetStatus: "COD_APPROVED", advanceRequired: false };
}
