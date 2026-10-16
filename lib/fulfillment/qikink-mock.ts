/**
 * Phase 6 — Qikink Mock Transport Fixture
 * Provides deterministic simulation of Qikink API responses for unit testing and offline development.
 */

import type {
  FulfillmentSnapshot,
  ProviderOrderSubmissionResult,
  ProviderOrderLookupResult,
  ProviderBalanceResult,
} from "./types";

export type MockScenario =
  | "success"
  | "unauthorized_401"
  | "forbidden_403"
  | "validation_400"
  | "rate_limit_429"
  | "server_error_500"
  | "timeout_before_send"
  | "timeout_ambiguous"
  | "timeout_ambiguous_absent"
  | "duplicate_reference"
  | "lookup_found"
  | "lookup_absent"
  | "action_required"
  | "out_of_stock"
  | "manifested"
  | "in_transit"
  | "delivered"
  | "rto"
  | "returned"
  | "unknown_status";

export class QikinkMockTransport {
  scenario: MockScenario = "success";
  mockOrders = new Map<string, ProviderOrderLookupResult>();
  callCount = 0;

  constructor(scenario: MockScenario = "success") {
    this.scenario = scenario;
  }

  setScenario(scenario: MockScenario) {
    this.scenario = scenario;
  }

  async submitOrder(snapshot: FulfillmentSnapshot): Promise<ProviderOrderSubmissionResult> {
    this.callCount++;

    switch (this.scenario) {
      case "success": {
        const provOrderId = `QIK-ORD-${Date.now()}`;
        const result: ProviderOrderLookupResult = {
          found: true,
          providerOrderId: provOrderId,
          providerStatus: "PRINTING",
          normalizedStatus: "PROCESSING",
          rawResponse: { status: "success", order_id: provOrderId },
        };
        this.mockOrders.set(provOrderId, result);
        this.mockOrders.set(snapshot.fulfillmentId, result);

        return {
          success: true,
          providerOrderId: provOrderId,
          providerStatus: "PRINTING",
          normalizedStatus: "PROCESSING",
          rawResponse: { status: "success", order_id: provOrderId },
        };
      }

      case "unauthorized_401":
        return {
          success: false,
          normalizedStatus: "FAILED",
          errorCode: "401_UNAUTHORIZED",
          errorMessage: "Invalid Qikink API Credentials",
        };

      case "forbidden_403":
        return {
          success: false,
          normalizedStatus: "FAILED",
          errorCode: "403_FORBIDDEN",
          errorMessage: "Merchant IP or API key forbidden",
        };

      case "validation_400":
        return {
          success: false,
          normalizedStatus: "FAILED",
          errorCode: "400_VALIDATION_ERROR",
          errorMessage: "Invalid SKU or missing design parameters",
        };

      case "rate_limit_429":
        return {
          success: false,
          normalizedStatus: "FAILED",
          errorCode: "429_RATE_LIMIT",
          errorMessage: "Too many Qikink API requests, retry backoff required",
        };

      case "server_error_500":
        return {
          success: false,
          normalizedStatus: "FAILED",
          errorCode: "500_SERVER_ERROR",
          errorMessage: "Qikink POD engine temporary outage",
        };

      case "timeout_before_send":
        throw new Error("Connection ECONNREFUSED before request sent");

      case "timeout_ambiguous":
      case "timeout_ambiguous_absent":
        throw new Error("Socket timeout waiting for Qikink HTTP response");

      case "duplicate_reference":
        return {
          success: false,
          normalizedStatus: "FAILED",
          errorCode: "DUPLICATE_REFERENCE",
          errorMessage: "Order reference already submitted to Qikink",
        };

      case "action_required":
        return {
          success: true,
          providerOrderId: `QIK-ORD-AR-${snapshot.fulfillmentId}`,
          providerStatus: "ACTION REQUIRED",
          normalizedStatus: "ACTION_REQUIRED",
          rawResponse: { status: "ACTION REQUIRED", reason: "Measurement mismatch on custom artwork" },
        };

      case "out_of_stock":
        return {
          success: true,
          providerOrderId: `QIK-ORD-OOS-${snapshot.fulfillmentId}`,
          providerStatus: "LIVE-OOS",
          normalizedStatus: "OUT_OF_STOCK",
          rawResponse: { status: "LIVE-OOS", reason: "Garment size M out of stock" },
        };

      default:
        return {
          success: true,
          providerOrderId: `QIK-ORD-${snapshot.fulfillmentId}`,
          providerStatus: "PRINTING",
          normalizedStatus: "PROCESSING",
        };
    }
  }

  async getOrder(providerOrderId: string, merchantReference?: string): Promise<ProviderOrderLookupResult> {
    if (this.scenario === "lookup_absent" || this.scenario === "timeout_ambiguous_absent") {
      return { found: false };
    }

    const key = providerOrderId || merchantReference || "";
    if (this.mockOrders.has(key)) {
      return this.mockOrders.get(key)!;
    }

    if (this.scenario === "action_required") {
      return {
        found: true,
        providerOrderId: key || "QIK-ORD-AR-1",
        providerStatus: "ACTION REQUIRED",
        normalizedStatus: "ACTION_REQUIRED",
      };
    }

    if (this.scenario === "out_of_stock") {
      return {
        found: true,
        providerOrderId: key || "QIK-ORD-OOS-1",
        providerStatus: "LIVE-OOS",
        normalizedStatus: "OUT_OF_STOCK",
      };
    }

    if (this.scenario === "manifested") {
      return {
        found: true,
        providerOrderId: key,
        providerStatus: "MANIFESTED",
        normalizedStatus: "MANIFESTED",
        awb: "AWB-QIK-998877",
        courier: "Delhivery",
      };
    }

    if (this.scenario === "in_transit") {
      return {
        found: true,
        providerOrderId: key,
        providerStatus: "IN_TRANSIT",
        normalizedStatus: "IN_TRANSIT",
        awb: "AWB-QIK-998877",
        courier: "Delhivery",
      };
    }

    if (this.scenario === "delivered") {
      return {
        found: true,
        providerOrderId: key,
        providerStatus: "DELIVERED",
        normalizedStatus: "DELIVERED",
        awb: "AWB-QIK-998877",
        courier: "Delhivery",
      };
    }

    if (this.scenario === "rto") {
      return {
        found: true,
        providerOrderId: key,
        providerStatus: "RTO",
        normalizedStatus: "RTO_INITIATED",
      };
    }

    if (this.scenario === "returned") {
      return {
        found: true,
        providerOrderId: key,
        providerStatus: "RETURNED",
        normalizedStatus: "RETURNED",
      };
    }

    if (this.scenario === "unknown_status") {
      return {
        found: true,
        providerOrderId: key,
        providerStatus: "SOME_CUSTOM_VENDOR_STATE",
        normalizedStatus: "UNKNOWN_PROVIDER_STATE",
      };
    }

    return {
      found: true,
      providerOrderId: key || "QIK-ORD-MOCK-1",
      providerStatus: "PRINTING",
      normalizedStatus: "PROCESSING",
    };
  }

  async getBalance(): Promise<ProviderBalanceResult> {
    return {
      supported: true,
      balanceAmount: 250000,
      currency: "INR",
      lastChecked: new Date().toISOString(),
      message: "Qikink mock wallet active",
    };
  }
}
