/**
 * Phase 7 — Authoritative COD Risk, RTO & Returned Inventory Types
 */

export type CodStatus =
  | "NOT_COD"
  | "COD_PENDING_CONFIRMATION"
  | "COD_OTP_PENDING"
  | "COD_CONFIRMED"
  | "COD_ADVANCE_REQUIRED"
  | "COD_ADVANCE_PENDING"
  | "COD_APPROVED"
  | "COD_REJECTED"
  | "COD_HELD"
  | "COD_PREPAID_ONLY"
  | "COD_EXPIRED";

export type CodRiskBand =
  | "NEW_CUSTOMER"
  | "TRUSTED_REPEAT"
  | "NORMAL"
  | "HIGH_RISK"
  | "PREPAID_ONLY";

export type CodDecision =
  | "FULL_COD"
  | "OTP_REQUIRED"
  | "ADVANCE_REQUIRED"
  | "MANUAL_HOLD"
  | "PREPAID_ONLY";

export type AdvanceStatus =
  | "not_required"
  | "pending"
  | "captured"
  | "failed"
  | "refunded";

export type CodRiskProfile = {
  id: string;
  customerId?: string;
  phoneNormalized: string;
  successfulCodDeliveries: number;
  successfulPrepaidDeliveries: number;
  codOrders: number;
  codConfirmedOrders: number;
  rtoCount: number;
  refusedCount: number;
  cancelledAfterConfirmationCount: number;
  lastRtoAt?: string;
  lastSuccessfulDeliveryAt?: string;
  riskScore: number;
  riskBand: CodRiskBand;
  prepaidOnly: boolean;
  manualHold: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type CodOtpChallenge = {
  id: string;
  orderId: string;
  phoneNormalized: string;
  otpHash: string;
  expiresAt: string;
  attemptCount: number;
  maxAttempts: number;
  verifiedAt?: string;
  consumedAt?: string;
  deliveryStatus?: "pending" | "sent" | "failed";
  resendCount?: number;
  createdAt: string;
};

export type ReuseStatus =
  | "AWAITING_RECEIPT"
  | "RECEIVED"
  | "INSPECTION_REQUIRED"
  | "REUSABLE"
  | "RESERVED"
  | "REUSED"
  | "DAMAGED"
  | "DISPOSED";

export type GarmentCondition =
  | "NEW_UNWORN"
  | "LIKE_NEW"
  | "MINOR_DEFECT"
  | "DAMAGED";

export type ReturnedInventoryItem = {
  id: string;
  sourceOrderId?: string;
  sourceOrderItemId?: string;
  fulfillmentId?: string;
  productId: string;
  variantId: string;
  designId: string;
  designVersion: number;
  sku: string;
  size?: string;
  color?: string;
  condition: GarmentCondition;
  manufacturingIdentityHash: string;
  manufacturingSnapshotJson?: Record<string, unknown>;
  receivedAt: string;
  ageDays: number;
  reuseStatus: ReuseStatus;
  reuseEligible: boolean;
  notes?: string;
  disposedAt?: string;
  reusedAt?: string;
  replacementOrderId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CodDecisionResult = {
  decision: CodDecision;
  codStatus: CodStatus;
  advanceAmountPaise?: number;
  riskScore: number;
  riskBand: CodRiskBand;
  reasons: string[];
};
