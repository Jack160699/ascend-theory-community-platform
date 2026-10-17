/**
 * Phase 6 — POD Fulfilment Subsystem Module Exports
 */

import type { Order } from "@/lib/orders/types";
import { createOrClaimFulfillmentAdmin, submitFulfillmentToProviderAdmin } from "./fulfillment-store";
import type { FulfillmentStatus } from "./types";

export * from "./types";
export * from "./provider-registry";
export * from "./qikink";
export * from "./qikink-mock";
export * from "./eligibility";
export * from "./fulfillment-store";

/**
 * Backward compatible helper for order fulfillment submission
 */
export async function submitOrderForFulfillment(order: Order): Promise<{
  success: boolean;
  provider?: string;
  externalId?: string;
  status?: FulfillmentStatus;
  message?: string;
}> {
  if (order.status === "refunded") {
    throw new Error(`Cannot submit refunded order ${order.id} for fulfillment.`);
  }

  if (order.status === "pending_payment" && order.paymentMethod === "online") {
    throw new Error(`Cannot submit unpaid order ${order.id} for fulfillment.`);
  }

  const claimRes = await createOrClaimFulfillmentAdmin(order.id, null);
  if (!claimRes.ok) {
    return {
      success: false,
      message: claimRes.error,
    };
  }

  const submitRes = await submitFulfillmentToProviderAdmin(claimRes.fulfillment.id, null);
  if (!submitRes.ok) {
    return {
      success: false,
      message: submitRes.error,
    };
  }

  return {
    success: true,
    provider: submitRes.fulfillment.providerId,
    externalId: submitRes.fulfillment.providerOrderId,
    status: submitRes.fulfillment.status,
    message: "Order submitted for fulfillment successfully.",
  };
}
