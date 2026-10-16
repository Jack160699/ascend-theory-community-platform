/**
 * Phase 6 — Provider-Neutral POD Fulfilment Subsystem Types
 * Defines status transitions, capability models, immutable snapshot schemas,
 * eligibility criteria, and the PODFulfillmentProvider interface.
 */

import type { PODProvider, ProviderProduct, ProviderVariant, PlacementLocation, PrintMethod } from "@/lib/wearables/design-types";
import type { Order } from "@/lib/orders/types";

export type FulfillmentResult = {
  provider: string;
  status: string;
  message?: string;
  externalId?: string;
};

export interface FulfillmentAdapter {
  readonly provider: string;
  submitOrder(order: Order): Promise<FulfillmentResult>;
}

export type FulfillmentStatus =
  | "READY"
  | "QUEUED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "PROCESSING"
  | "ACTION_REQUIRED"
  | "OUT_OF_STOCK"
  | "PRINTED"
  | "MANIFESTED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "EXCEPTION"
  | "RTO_INITIATED"
  | "RETURNED"
  | "CANCELLED"
  | "FAILED"
  | "RECONCILIATION_REQUIRED"
  | "UNKNOWN_PROVIDER_STATE";

export type ProviderCapabilityModel = {
  submitOrder: boolean;
  orderLookup: boolean;
  cancellation: boolean;
  walletBalance: boolean;
  webhookStatus: boolean;
  pollingStatus: boolean;
};

export type ActivePlacementSnapshot = {
  placementId: string;
  designId: string;
  designVersion: number;
  designSlug: string;
  designTitle: string;
  storagePath: string;
  checksum?: string;
  placementLocation: PlacementLocation;
  xNormalized: number;
  yNormalized: number;
  scale: number;
  rotationDeg: number;
  widthMm: number;
  heightMm: number;
  printMethod: PrintMethod;
  /** Transient short-lived signed preview URL generated at submission time only */
  transientSignedUrl?: string;
};

export type FulfillmentItemSnapshot = {
  orderItemId: string;
  productId: string;
  variantId: string;
  ascendSku: string;
  quantity: number;

  providerProductMappingId: string;
  providerExternalProductId: string;
  providerVariantMappingId: string;
  providerExternalVariantId: string;
  providerExternalSku: string;

  placements: ActivePlacementSnapshot[];
};

export type FulfillmentSnapshot = {
  fulfillmentId: string;
  orderId: string;
  orderNumber?: string;
  items: FulfillmentItemSnapshot[];

  providerId: string;
  providerSlug: string;

  customerShipping: {
    fullName: string;
    email: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };

  isCod: boolean;
  paymentMode: "online" | "cod";
  currency: string;
  requestHash?: string;
  createdAt: string;
};

export type FulfillmentEligibilityResult = {
  eligible: boolean;
  blockingReasons: string[];
  order?: Order;
  provider?: PODProvider;
  providerProduct?: ProviderProduct;
  providerVariant?: ProviderVariant;
};

export type ProviderOrderSubmissionResult = {
  success: boolean;
  providerOrderId?: string;
  providerStatus?: string;
  normalizedStatus: FulfillmentStatus;
  rawResponse?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  isAmbiguousNetworkFailure?: boolean;
};

export type ProviderOrderLookupResult = {
  found: boolean;
  providerOrderId?: string;
  providerStatus?: string;
  normalizedStatus?: FulfillmentStatus;
  rawResponse?: Record<string, unknown>;
  awb?: string;
  courier?: string;
};

export type ProviderBalanceResult = {
  supported: boolean;
  balanceAmount?: number;
  currency?: string;
  lastChecked?: string;
  message?: string;
};

/**
 * Provider-Neutral POD Fulfillment Provider Interface (Req #3)
 */
export interface PODFulfillmentProvider {
  readonly providerSlug: string;
  readonly capabilities: ProviderCapabilityModel;

  validateConfiguration(): { isValid: boolean; error?: string };
  submitOrder(snapshot: FulfillmentSnapshot): Promise<ProviderOrderSubmissionResult>;
  getOrder(providerOrderId: string, merchantReference?: string): Promise<ProviderOrderLookupResult>;
  cancelOrder?(providerOrderId: string): Promise<{ success: boolean; message?: string }>;
  getShipment?(providerOrderId: string): Promise<{ awb?: string; courier?: string; status?: string }>;
  getBalance?(): Promise<ProviderBalanceResult>;
  normalizeStatus(rawStatus: string): FulfillmentStatus;
  healthCheck?(): Promise<{ ok: boolean; message?: string }>;
}

/**
 * Support-Safe Fulfillment DTO (Requirement #6)
 * Sanitized view for HQ support staff that excludes snapshots, request hashes,
 * artwork storage paths, and payment internals.
 */
export type FulfillmentSupportDTO = {
  id: string;
  orderId: string;
  status: FulfillmentStatus;
  providerStatus?: string;
  trackingNumber?: string;
  courierName?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
};
