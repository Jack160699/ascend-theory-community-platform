/**
 * Phase 7 — Authoritative Deterministic COD Decision Engine (Requirements #6 & #7)
 */

import type { Order } from "@/lib/orders/types";
import type { CodRiskProfile, CodDecisionResult, CodRiskBand } from "./types";
import { DEFAULT_MAX_DAILY_COD_EXPOSURE_PAISE } from "./exposure";

export type CodDecisionEngineConfig = {
  maxOrderValuePaise?: number; // e.g. 500000 (₹5,000)
  maxItemCount?: number; // e.g. 3 items
  maxDailyExposurePaise?: number; // e.g. 5000000 (₹50,000)
  defaultAdvanceAmountPaise?: number; // e.g. 20000 (₹200)
};

export const DEFAULT_COD_ENGINE_CONFIG: CodDecisionEngineConfig = {
  maxOrderValuePaise: 500000,
  maxItemCount: 3,
  maxDailyExposurePaise: DEFAULT_MAX_DAILY_COD_EXPOSURE_PAISE,
  defaultAdvanceAmountPaise: 20000,
};

/**
 * Deterministically evaluates COD order risk and decides COD status & workflow requirement.
 */
export function evaluateCodOrderDecision(
  order: Order,
  riskProfile?: CodRiskProfile | null,
  currentDailyExposurePaise: number = 0,
  config: CodDecisionEngineConfig = DEFAULT_COD_ENGINE_CONFIG,
): CodDecisionResult {
  const maxOrderVal = config.maxOrderValuePaise ?? 500000;
  const maxItems = config.maxItemCount ?? 3;
  const maxDailyExp = config.maxDailyExposurePaise ?? DEFAULT_MAX_DAILY_COD_EXPOSURE_PAISE;
  const advanceAmount = config.defaultAdvanceAmountPaise ?? 20000;

  const orderTotalPaise = Math.round((order.subtotal || 0) * 100);
  const totalItemQuantity = (order.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);

  const rtoCount = riskProfile?.rtoCount ?? 0;
  const refusedCount = riskProfile?.refusedCount ?? 0;
  const successfulCodDeliveries = riskProfile?.successfulCodDeliveries ?? 0;
  const isPrepaidOnly = riskProfile?.prepaidOnly ?? false;
  const isManualHold = riskProfile?.manualHold ?? false;

  // 1. Explicit Prepaid Only Flag or Severe RTO History (>= 2 RTOs)
  if (isPrepaidOnly || rtoCount >= 2) {
    return {
      decision: "PREPAID_ONLY",
      codStatus: "COD_PREPAID_ONLY",
      riskScore: 90,
      riskBand: "PREPAID_ONLY",
      reasons: ["REPEATED_RTO_HISTORY_PREPAID_ONLY"],
    };
  }

  // 2. Manual Hold Flagged on Customer Profile
  if (isManualHold) {
    return {
      decision: "MANUAL_HOLD",
      codStatus: "COD_HELD",
      riskScore: 80,
      riskBand: "HIGH_RISK",
      reasons: ["MANUAL_HOLD_FLAGGED"],
    };
  }

  // 3. Daily COD Liability Cap Exceeded
  if (currentDailyExposurePaise >= maxDailyExp) {
    return {
      decision: "MANUAL_HOLD",
      codStatus: "COD_HELD",
      riskScore: 60,
      riskBand: "NORMAL",
      reasons: ["DAILY_COD_EXPOSURE_CAP_EXCEEDED"],
    };
  }

  // 4. High Value or High Quantity Order Guard
  if (orderTotalPaise > maxOrderVal || totalItemQuantity > maxItems) {
    return {
      decision: "ADVANCE_REQUIRED",
      codStatus: "COD_ADVANCE_REQUIRED",
      advanceAmountPaise: advanceAmount,
      riskScore: 50,
      riskBand: "NORMAL",
      reasons: [
        orderTotalPaise > maxOrderVal
          ? "HIGH_VALUE_ORDER_ADVANCE_REQUIRED"
          : "HIGH_ITEM_QUANTITY_ADVANCE_REQUIRED",
      ],
    };
  }

  // 5. Trusted Repeat Customer (>= 2 successful COD deliveries, 0 RTOs)
  if (successfulCodDeliveries >= 2 && rtoCount === 0) {
    return {
      decision: "FULL_COD",
      codStatus: "COD_APPROVED",
      riskScore: 10,
      riskBand: "TRUSTED_REPEAT",
      reasons: ["TRUSTED_REPEAT_CUSTOMER_AUTO_APPROVED"],
    };
  }

  // 6. High Risk / Prior Single RTO or Refusal
  if (rtoCount > 0 || refusedCount > 0) {
    return {
      decision: "ADVANCE_REQUIRED",
      codStatus: "COD_ADVANCE_REQUIRED",
      advanceAmountPaise: advanceAmount,
      riskScore: 70,
      riskBand: "HIGH_RISK",
      reasons: ["PRIOR_RTO_HISTORY_ADVANCE_REQUIRED"],
    };
  }

  // 7. Standard New Customer -> OTP Verification Required
  return {
    decision: "OTP_REQUIRED",
    codStatus: "COD_OTP_PENDING",
    riskScore: 30,
    riskBand: (riskProfile?.riskBand as CodRiskBand) || "NEW_CUSTOMER",
    reasons: ["NEW_CUSTOMER_OTP_VERIFICATION_REQUIRED"],
  };
}

/**
 * Applies a COD decision atomically via SECURITY DEFINER RPC when Supabase is configured.
 */
export async function applyCodDecisionAdmin(
  orderId: string,
  targetStatus: string,
  decisionReason: string,
  advanceRequired: boolean = false,
  advanceAmountPaise: number = 0,
  adminId: string | null = null,
): Promise<{ ok: boolean; error?: string }> {
  const { hasSupabaseConfig } = await import("@/lib/supabase/env");
  const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
  const { getOrderAdmin, saveOrder } = await import("@/lib/orders/store");

  if (hasSupabaseConfig()) {
    const supabase = createSupabaseServiceClient();
    if (supabase) {
      const { data, error } = await supabase.rpc("apply_cod_decision_with_audit", {
        p_order_id: orderId,
        p_target_status: targetStatus,
        p_decision_reason: decisionReason,
        p_advance_required: advanceRequired,
        p_advance_amount_paise: advanceAmountPaise,
        p_admin_id: adminId,
      });

      if (error) {
        console.error("[DecisionEngine] RPC error applying COD decision:", error);
        return { ok: false, error: error.message };
      }
      return { ok: true };
    }
  }

  // Memory fallback for dev/testing
  const order = await getOrderAdmin(orderId);
  if (!order) return { ok: false, error: "Order not found" };

  const updatedOrder = {
    ...order,
    codStatus: targetStatus as import("./types").CodStatus,
    advanceRequired,
    advanceAmountPaise,
    advanceStatus: (advanceRequired ? "pending" : "none") as import("./types").AdvanceStatus,
  };

  await saveOrder(updatedOrder);
  return { ok: true };
}

/**
 * Applies an explicit operational override via SECURITY DEFINER RPC when Supabase is configured.
 * Requires adminId and mandatory overrideReason.
 */
export async function overrideCodStatusAdmin(
  orderId: string,
  targetStatus: string,
  overrideReason: string,
  adminId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!adminId) {
    return { ok: false, error: "Admin ID is required for operational COD override" };
  }
  if (!overrideReason || !overrideReason.trim()) {
    return { ok: false, error: "Mandatory override reason is required" };
  }

  const { hasSupabaseConfig } = await import("@/lib/supabase/env");
  const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
  const { getOrderAdmin, saveOrder } = await import("@/lib/orders/store");

  if (hasSupabaseConfig()) {
    const supabase = createSupabaseServiceClient();
    if (supabase) {
      const { error } = await supabase.rpc("override_cod_status_with_audit", {
        p_order_id: orderId,
        p_target_status: targetStatus,
        p_override_reason: overrideReason,
        p_admin_id: adminId,
      });

      if (error) {
        console.error("[DecisionEngine] RPC error applying COD override:", error);
        return { ok: false, error: error.message };
      }
      return { ok: true };
    }
  }

  // Memory fallback for dev/testing
  const order = await getOrderAdmin(orderId);
  if (!order) return { ok: false, error: "Order not found" };

  const updatedOrder = {
    ...order,
    codStatus: targetStatus as import("./types").CodStatus,
  };

  await saveOrder(updatedOrder);
  return { ok: true };
}
