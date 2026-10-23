/**
 * Qikink POD Provider Adapter — sends orders (with artwork, mockup and placement)
 * to Qikink and reads back status, AWB and courier.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import type {
  PODFulfillmentProvider,
  ProviderCapabilityModel,
  FulfillmentSnapshot,
  ProviderOrderSubmissionResult,
  ProviderOrderLookupResult,
  ProviderBalanceResult,
  FulfillmentStatus,
} from "./types";
import { QikinkMockTransport } from "./qikink-mock";
import type { PlacementLocation, PrintMethod } from "@/lib/wearables/design-types";
import { qikinkSendingEnabled, qikinkFxToInr,
  QikinkApiError,
  QikinkClient,
  extractQikinkOrderId,
  extractShipment,
  getQikinkConfig,
  toOrderList,
  toQikinkOrderNumber,
  type QikinkDesign,
  type QikinkLineItem,
  type QikinkOrderPayload,
} from "./qikink-client";

/**
 * Qikink's documented API contract (token / order create / order read) is implemented
 * in ./qikink-client. Live transport needs credentials; QIKINK_FULFILLMENT_ENABLED=false switches it off
 * and merchant credentials (QIKINK_CLIENT_ID, QIKINK_CLIENT_SECRET).
 */
export const QIKINK_API_CONTRACT_VERIFIED = true;

export function redactSecrets<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data === "string") {
    if (data.includes("token=") || data.includes("Signature=")) {
      return data.replace(/(\?|&)(token|Signature|apiKey|secret)=[^&]+/gi, "$1$2=[REDACTED]") as unknown as T;
    }
    return data;
  }
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) {
    return data.map((item) => redactSecrets(item)) as unknown as T;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("key") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("token") ||
      lowerKey.includes("auth") ||
      lowerKey.includes("password") ||
      lowerKey.includes("signature")
    ) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = redactSecrets(value);
    }
  }
  return redacted as T;
}

export class QikinkFulfillmentAdapter implements PODFulfillmentProvider {
  readonly providerSlug = "qikink" as const;

  readonly capabilities: ProviderCapabilityModel = {
    submitOrder: true,
    orderLookup: true,
    cancellation: false, // Qikink has no cancel API
    walletBalance: false,
    webhookStatus: false, // Qikink has no webhooks
    pollingStatus: true,
  };

  private mockTransport?: QikinkMockTransport;

  constructor(mockTransport?: QikinkMockTransport) {
    this.mockTransport = mockTransport;
  }

  validateConfiguration(): { isValid: boolean; error?: string } {
    if (!qikinkSendingEnabled()) {
      return { isValid: false, error: "Qikink sending is switched off (QIKINK_FULFILLMENT_ENABLED=false)." };
    }
    if (!getQikinkConfig()) {
      return { isValid: false, error: "Qikink credentials missing — set QIKINK_CLIENT_SECRET (and QIKINK_CLIENT_ID for live)." };
    }
    return { isValid: true };
  }

  private client(): QikinkClient {
    const config = getQikinkConfig();
    if (!config) throw new Error("Qikink credentials missing");
    return new QikinkClient(config);
  }

  /** Builds Qikink's order payload from an immutable fulfilment snapshot. */
  async buildPayload(snapshot: FulfillmentSnapshot): Promise<QikinkOrderPayload> {
    const site = siteOrigin();
    // Qikink works in rupees. Non-INR prices are converted with QIKINK_FX_TO_INR;
    // a COD order must know the exact rupee amount the courier collects.
    const currency = (snapshot.currency || "INR").toUpperCase();
    const fx = currency === "INR" ? 1 : qikinkFxToInr();
    if (currency !== "INR" && !(fx > 0)) {
      throw new Error(`Order is in ${currency}; set QIKINK_FX_TO_INR so Qikink gets rupee amounts.`);
    }
    const toInr = (n: number) => n * fx;
    const lineItems: QikinkLineItem[] = [];
    for (const item of snapshot.items || []) {
      if (!item.providerExternalSku) throw new Error(`Item ${item.ascendSku} has no Qikink SKU mapped.`);
      const mockup = absoluteUrl(item.mockupUrl, site);
      const designs: QikinkDesign[] = [];
      for (const pl of item.placements || []) {
        const designLink = await artworkLink(pl.storagePath);
        if (!designLink) throw new Error(`Artwork for ${pl.designTitle} could not be linked.`);
        if (!mockup) throw new Error(`Item ${item.ascendSku} has no approved mockup image.`);
        designs.push({
          design_code: designCode(pl.designId || pl.designSlug, pl.designVersion, placementSku(pl.placementLocation)),
          width_inches: mmToInches(pl.widthMm),
          height_inches: mmToInches(pl.heightMm),
          placement_sku: placementSku(pl.placementLocation),
          design_link: designLink,
          mockup_link: mockup,
        });
      }
      if (designs.length === 0) throw new Error(`Item ${item.ascendSku} has no active design placement.`);
      lineItems.push({
        search_from_my_products: 0,
        sku: item.providerExternalSku,
        quantity: String(item.quantity),
        price: moneyString(toInr(item.unitPrice ?? 0)),
        print_type_id: printTypeId(item.placements[0]!.printMethod),
        designs,
      });
    }

    const ship = snapshot.customerShipping;
    const [firstName, ...rest] = (ship.fullName || "").trim().split(/\s+/);
    const total =
      snapshot.orderTotal ??
      (snapshot.items || []).reduce((sum, it) => sum + (it.unitPrice ?? 0) * it.quantity, 0);

    return {
      order_number: toQikinkOrderNumber(snapshot.orderNumber || snapshot.orderId),
      qikink_shipping: "1",
      gateway: snapshot.isCod ? "COD" : "Prepaid",
      total_order_value: moneyString(Math.round(toInr(total))),
      line_items: lineItems,
      shipping_address: {
        first_name: firstName || ship.fullName || "Customer",
        last_name: rest.join(" "),
        address1: (ship.addressLine1 || "").slice(0, 90),
        address2: (ship.addressLine2 || "").slice(0, 90),
        phone: (ship.phone || "").replace(/[^0-9+]/g, ""),
        email: ship.email || "",
        city: ship.city || "",
        zip: ship.postalCode || "",
        province: ship.state || "",
        country_code: countryCode(ship.country),
      },
    };
  }

  async submitOrder(snapshot: FulfillmentSnapshot): Promise<ProviderOrderSubmissionResult> {
    if (this.mockTransport) {
      return this.mockTransport.submitOrder(snapshot);
    }

    const configCheck = this.validateConfiguration();
    if (!configCheck.isValid) {
      return {
        success: false,
        normalizedStatus: "FAILED",
        errorCode: "QIKINK_FULFILLMENT_DISABLED",
        errorMessage: configCheck.error || "Qikink fulfillment disabled",
      };
    }

    let payload: QikinkOrderPayload;
    try {
      payload = await this.buildPayload(snapshot);
    } catch (err) {
      return {
        success: false,
        normalizedStatus: "FAILED",
        errorCode: "QIKINK_PAYLOAD_INVALID",
        errorMessage: err instanceof Error ? err.message : "Could not build Qikink order",
      };
    }

    const client = this.client();
    let body: unknown;
    try {
      body = await client.createOrder(payload);
    } catch (err) {
      if (err instanceof QikinkApiError) {
        // A retry of an order Qikink already accepted is refused as a duplicate — find and bind it.
        if (/duplicate/i.test(err.message)) {
          const existing = await client.findOrderByNumber(payload.order_number).catch(() => null);
          if (existing) {
            const shipment = extractShipment(existing);
            return {
              success: true,
              providerOrderId: extractQikinkOrderId(existing) || payload.order_number,
              providerStatus: shipment.status || "Received",
              normalizedStatus: "PROCESSING",
              rawResponse: redactSecrets({ duplicateOf: existing }),
            };
          }
        }
        if (err.ambiguous) throw err; // → RECONCILIATION_REQUIRED + lookup by order number
        return {
          success: false,
          normalizedStatus: "FAILED",
          providerStatus: `HTTP ${err.httpStatus}`,
          errorCode: err.httpStatus === 429 ? "429_RATE_LIMIT" : err.httpStatus >= 500 ? "500_SERVER_ERROR" : "QIKINK_REJECTED",
          errorMessage: err.message,
          rawResponse: redactSecrets({ response: err.body as Record<string, unknown> }),
        };
      }
      throw err;
    }

    return {
      success: true,
      providerOrderId: extractQikinkOrderId(body) || payload.order_number,
      providerStatus: "Received",
      normalizedStatus: "PROCESSING",
      rawResponse: redactSecrets({ response: body as Record<string, unknown>, orderNumber: payload.order_number, env: client.env }),
    };
  }

  async getOrder(providerOrderId: string, merchantReference?: string): Promise<ProviderOrderLookupResult> {
    if (this.mockTransport) {
      return this.mockTransport.getOrder(providerOrderId, merchantReference);
    }
    if (!getQikinkConfig()) return { found: false };
    const client = this.client();

    let order: Record<string, unknown> | null = null;
    const isOurNumber = providerOrderId && !/^\d+$/.test(providerOrderId);
    if (providerOrderId && !isOurNumber) {
      const list = toOrderList(await client.getOrderById(providerOrderId).catch(() => null));
      order = list[0] ?? null;
    }
    if (!order) {
      const ref = merchantReference || providerOrderId;
      const number = toQikinkOrderNumber(ref.replace(/^ASCEND-ORD-/, ""));
      order = await client.findOrderByNumber(number).catch(() => null);
    }
    if (!order) return { found: false };

    const shipment = extractShipment(order);
    return {
      found: true,
      providerOrderId: extractQikinkOrderId(order) || providerOrderId,
      providerStatus: shipment.status,
      normalizedStatus: shipment.status ? this.normalizeStatus(shipment.status) : "PROCESSING",
      awb: shipment.awb,
      courier: shipment.courier,
      rawResponse: redactSecrets({ order }),
    };
  }

  async getBalance(): Promise<ProviderBalanceResult> {
    if (this.mockTransport) {
      return this.mockTransport.getBalance();
    }
    return { supported: false, message: "Qikink's API does not expose wallet balance." };
  }

  normalizeStatus(rawStatus: string): FulfillmentStatus {
    if (this.mockTransport) {
      const s = (rawStatus || "").toUpperCase().trim();
      const known: FulfillmentStatus[] = [
        "PROCESSING", "ACTION_REQUIRED", "OUT_OF_STOCK", "MANIFESTED", "IN_TRANSIT",
        "DELIVERED", "RTO_INITIATED", "RETURNED", "CANCELLED", "FAILED",
      ];
      return known.includes(s as FulfillmentStatus) ? (s as FulfillmentStatus) : "UNKNOWN_PROVIDER_STATE";
    }
    return normalizeQikinkStatus(rawStatus);
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    const config = this.validateConfiguration();
    if (!config.isValid) return { ok: false, message: config.error };
    try {
      await this.client().getToken(true);
      return { ok: true, message: `Connected to Qikink (${getQikinkConfig()!.env}).` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Qikink login failed" };
    }
  }
}

/* ───────────────────────── Mapping helpers ───────────────────────── */

/** Qikink order / courier statuses → our fulfilment statuses. */
const QIKINK_STATUS_MAP: [RegExp, FulfillmentStatus][] = [
  [/rto.*(deliver|received|complete)|^returned|partially returned/i, "RETURNED"],
  [/rto|return.*initiat|reverse pickup/i, "RTO_INITIATED"],
  [/^delivered|delivered$/i, "DELIVERED"],
  [/cancel/i, "CANCELLED"],
  [/out of stock|oos/i, "OUT_OF_STOCK"],
  [/hold|action required|design issue|query|pending approval/i, "ACTION_REQUIRED"],
  [/not attempted|undelivered|unavailable|closed|otp|incorrect|incomplete address|maximum attempts|refused|lost|exception/i, "EXCEPTION"],
  [/picked|in.?transit|shipped|dispatch|out for delivery|reschedul|misrout|oda|self collect/i, "IN_TRANSIT"],
  [/ready to ship|manifest|packed|awb assigned|pickup scheduled/i, "MANIFESTED"],
  [/printed|quality|qc/i, "PRINTED"],
  [/pending|new|received|confirm|process|production|printing|accepted|open/i, "PROCESSING"],
];

export function normalizeQikinkStatus(rawStatus: string): FulfillmentStatus {
  const s = (rawStatus || "").trim();
  if (!s) return "UNKNOWN_PROVIDER_STATE";
  for (const [re, status] of QIKINK_STATUS_MAP) if (re.test(s)) return status;
  return "UNKNOWN_PROVIDER_STATE";
}

function envJson<T extends Record<string, unknown>>(name: string, fallback: T): T {
  try {
    const raw = process.env[name];
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Qikink placement codes from Qikink's API docs: fr Front, bk Back, lp Left Pocket,
 * rp Right Pocket, ls Left Shoulder, rs Right Shoulder. Override with QIKINK_PLACEMENT_MAP.
 */
export function placementSku(location: PlacementLocation): string {
  const map = envJson<Record<string, string>>("QIKINK_PLACEMENT_MAP", {
    front: "fr",
    back: "bk",
    left_chest: "lp",
    right_chest: "rp",
    left_sleeve: "ls",
    right_sleeve: "rs",
    neck: "bk",
    custom: "fr",
  });
  return map[location] ?? "fr";
}

/** Qikink print_type_id values from Qikink's API docs. Override with QIKINK_PRINT_TYPE_MAP. */
export const QIKINK_PRINT_TYPE_IDS: Record<PrintMethod, number> = {
  dtg: 1,
  screen_print: 1,
  other: 1,
  embroidery: 3,
  puff: 6,
  glow: 7,
  vinyl_rainbow: 12,
  vinyl_gold: 13,
  vinyl_silver: 14,
  vinyl_reflective: 15,
  dtf: 17,
  sublimation: 23,
};

export function printTypeId(method: PrintMethod): number {
  const map = envJson<Record<string, number>>("QIKINK_PRINT_TYPE_MAP", QIKINK_PRINT_TYPE_IDS);
  return Number(map[method] ?? QIKINK_PRINT_TYPE_IDS[method] ?? 1);
}

function mmToInches(mm: number): string {
  return (Math.round((mm / 25.4) * 10) / 10).toString();
}

function moneyString(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/**
 * Qikink identifies artwork by design_code (new codes: max 20 characters), so the code changes
 * whenever the artwork version changes: "AT" + 8 chars of the design id + version + placement.
 */
export function designCode(designRef: string, version: number, placementCode: string): string {
  const ref = (designRef || "design").replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  return `AT${ref}v${version || 1}${placementCode}`.slice(0, 20);
}

function countryCode(country?: string): string {
  const c = (country || "").trim();
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  if (/^india$/i.test(c) || !c) return "IN";
  return c.slice(0, 2).toUpperCase();
}

function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://www.ascendtheory.in").replace(/\/$/, "");
}

function absoluteUrl(url: string | undefined, site: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//.test(url)) return url;
  return `${site}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Qikink fetches the artwork after the order is placed, so the signed link lives 30 days. */
const ARTWORK_LINK_TTL_S = 60 * 60 * 24 * 30;

async function artworkLink(storagePath: string): Promise<string | undefined> {
  if (!storagePath) return undefined;
  if (/^https?:\/\//.test(storagePath)) return storagePath;
  if (storagePath.startsWith("/")) return absoluteUrl(storagePath, siteOrigin());
  if (!hasSupabaseConfig()) return undefined;
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) return undefined;
  const { data } = await serviceClient.storage.from("design-artwork").createSignedUrl(storagePath, ARTWORK_LINK_TTL_S);
  return data?.signedUrl || undefined;
}
