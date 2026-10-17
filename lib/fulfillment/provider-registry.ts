/**
 * Phase 6 — POD Fulfilment Provider Adapter Registry
 * Instantiates the appropriate provider-neutral POD adapter based on provider slug.
 */

import type { PODFulfillmentProvider } from "./types";
import { QikinkFulfillmentAdapter } from "./qikink";
import { QikinkMockTransport } from "./qikink-mock";

export function getFulfillmentProviderAdapter(
  providerSlug: string,
  mockTransport?: QikinkMockTransport,
): PODFulfillmentProvider {
  const normalizedSlug = providerSlug.toLowerCase().trim();
  if (normalizedSlug === "qikink") {
    return new QikinkFulfillmentAdapter(mockTransport);
  }

  throw new Error(`provider_adapter_mismatch: No active production adapter configured for provider '${providerSlug}'`);
}
