import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import {
  QikinkClient,
  extractQikinkError,
  extractQikinkOrderId,
  extractShipment,
  getQikinkConfig,
  qikinkAutoSubmitEnabled,
  qikinkFxToInr,
  qikinkOrderNumber,
  toQikinkOrderNumber,
} from "../qikink-client";
import { QikinkFulfillmentAdapter, normalizeQikinkStatus } from "../qikink";
import { statusPath } from "../qikink-sync";
import type { FulfillmentSnapshot } from "../types";

const realFetch = globalThis.fetch;

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function mockFetch(handler: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const call: Call = {
      url: String(input),
      method: init?.method || "GET",
      headers,
      body: init?.body ? String(init.body) : "",
    };
    calls.push(call);
    const res = handler(call);
    return new Response(typeof res.body === "string" ? res.body : JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

const config = { clientId: "CID-1", clientSecret: "S3CRET", env: "sandbox" as const, baseUrl: "https://sandbox.qikink.com" };

describe("Qikink client — documented API contract", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("mints a token with form-urlencoded ClientId/client_secret and sends ClientId + Accesstoken headers", async () => {
    const calls = mockFetch((c) =>
      c.url.endsWith("/api/token")
        ? { body: { Accesstoken: "tok-1", expires_in: 3600 } }
        : { body: { order_id: 98765 } },
    );
    const client = new QikinkClient({ ...config, clientId: "CID-A" });
    const res = await client.createOrder({
      order_number: "AT1",
      qikink_shipping: "1",
      gateway: "Prepaid",
      total_order_value: "999",
      line_items: [],
      shipping_address: {
        first_name: "A", last_name: "", address1: "x", address2: "", phone: "9", email: "e",
        city: "c", zip: "z", province: "p", country_code: "IN",
      },
    });
    assert.strictEqual(extractQikinkOrderId(res), "98765");
    const token = calls[0]!;
    assert.strictEqual(token.method, "POST");
    assert.strictEqual(token.headers["content-type"], "application/x-www-form-urlencoded");
    assert.match(token.body, /ClientId=CID-A/);
    assert.match(token.body, /client_secret=S3CRET/);
    const create = calls[1]!;
    assert.strictEqual(create.url, "https://sandbox.qikink.com/api/order/create");
    assert.strictEqual(create.headers["clientid"], "CID-A");
    assert.strictEqual(create.headers["accesstoken"], "tok-1");
  });

  it("re-mints the token once when Qikink rejects it", async () => {
    let tokenN = 0;
    let orderCalls = 0;
    mockFetch((c) => {
      if (c.url.endsWith("/api/token")) return { body: { Accesstoken: `tok-${++tokenN}` } };
      orderCalls++;
      return c.headers["accesstoken"] === "tok-2"
        ? { body: [{ id: 1, number: "123_AT9", status: "Processing" }] }
        : { status: 401, body: { error: "Invalid token" } };
    });
    const client = new QikinkClient({ ...config, clientId: "CID-B" });
    const body = await client.listOrders(1);
    assert.ok(Array.isArray(body));
    assert.strictEqual(tokenN, 2);
    assert.strictEqual(orderCalls, 2);
  });

  it("treats HTTP 200 with an error body as a failure", () => {
    assert.strictEqual(extractQikinkError(200, { error: "Invalid SKU" }), "Invalid SKU");
    assert.strictEqual(extractQikinkError(200, { success: false, message: "Order no. cannot exceed 15 chars" }), "Order no. cannot exceed 15 chars");
    assert.strictEqual(extractQikinkError(200, { order_id: 5 }), null);
    assert.strictEqual(extractQikinkError(200, []), null);
  });

  it("keeps order numbers within Qikink's 15 alphanumeric characters and strips its account prefix", () => {
    assert.strictEqual(toQikinkOrderNumber("AT-20261016-X4PD"), "AT20261016X4PD");
    assert.ok(toQikinkOrderNumber("ORDER-1234567890-ABCDEFGH").length <= 15);
    assert.strictEqual(qikinkOrderNumber({ number: "654367_AT20261016X4PD" }), "AT20261016X4PD");
  });

  it("reads AWB, courier and status from nested shipping data", () => {
    const s = extractShipment({ status: "Shipped", shipping: { awb_no: "AWB123", courier_name: "Delhivery" } });
    assert.deepStrictEqual([s.status, s.awb, s.courier], ["Shipped", "AWB123", "Delhivery"]);
  });

  it("maps Qikink statuses onto the fulfilment lifecycle", () => {
    assert.strictEqual(normalizeQikinkStatus("Order Received"), "PROCESSING");
    assert.strictEqual(normalizeQikinkStatus("Ready To Ship"), "MANIFESTED");
    assert.strictEqual(normalizeQikinkStatus("In-Transit"), "IN_TRANSIT");
    assert.strictEqual(normalizeQikinkStatus("Out For Delivery"), "IN_TRANSIT");
    assert.strictEqual(normalizeQikinkStatus("Delivered"), "DELIVERED");
    assert.strictEqual(normalizeQikinkStatus("RTO Initiated"), "RTO_INITIATED");
    assert.strictEqual(normalizeQikinkStatus("RTO Delivered"), "RETURNED");
    assert.strictEqual(normalizeQikinkStatus("Cancelled"), "CANCELLED");
    assert.strictEqual(normalizeQikinkStatus("Refused to accept"), "EXCEPTION");
  });

  it("records status jumps step by step through valid transitions", () => {
    assert.deepStrictEqual(statusPath("PROCESSING", "DELIVERED"), ["IN_TRANSIT", "DELIVERED"]);
    assert.deepStrictEqual(statusPath("SUBMITTED", "RETURNED"), ["IN_TRANSIT", "RTO_INITIATED", "RETURNED"]);
    assert.strictEqual(statusPath("DELIVERED", "PROCESSING"), null);
  });

  it("builds Qikink's order payload with design link, mockup, placement and rupee amounts", async () => {
    process.env.QIKINK_FX_TO_INR = "85";
    const snapshot = {
      fulfillmentId: "f1",
      orderId: "AT-20261017-AB12",
      orderNumber: "AT-20261017-AB12",
      providerId: "p",
      providerSlug: "qikink",
      isCod: false,
      paymentMode: "online",
      currency: "USD",
      orderTotal: 110,
      createdAt: "",
      customerShipping: {
        fullName: "Shriyansh Chandrakar", email: "a@b.c", phone: "+91 98765-43210",
        addressLine1: "1 Road", addressLine2: "", city: "Bhilai", state: "Chhattisgarh", postalCode: "490001", country: "India",
      },
      items: [{
        orderItemId: "oi", productId: "p", variantId: "v", ascendSku: "NRATLU-EMBER-BLK-M", quantity: 1,
        providerProductMappingId: "pp", providerExternalProductId: "x", providerVariantMappingId: "pv",
        providerExternalVariantId: "y", providerExternalSku: "UOs-Bk-M", unitPrice: 110,
        mockupUrl: "/images/drops/nratlu/shots/flat-ember.webp",
        placements: [{
          placementId: "pl", designId: "d", designVersion: 1, designSlug: "nratlu-ember-print", designTitle: "Ember",
          storagePath: "https://www.ascendtheory.in/images/drops/nratlu/artwork/print-01-ember-rider.png",
          placementLocation: "front", xNormalized: 0.5, yNormalized: 0.38, scale: 1, rotationDeg: 0,
          widthMm: 305, heightMm: 201, printMethod: "dtg",
        }],
      }],
    } as unknown as FulfillmentSnapshot;

    const payload = await new QikinkFulfillmentAdapter().buildPayload(snapshot);
    assert.strictEqual(payload.order_number, "AT20261017AB12");
    assert.strictEqual(payload.gateway, "Prepaid");
    assert.strictEqual(payload.total_order_value, "9350");
    const line = payload.line_items[0]!;
    assert.strictEqual(line.search_from_my_products, 0);
    assert.strictEqual(line.sku, "UOs-Bk-M");
    assert.strictEqual(line.price, "9350");
    assert.strictEqual(line.print_type_id, 1);
    const design = line.designs![0]!;
    assert.strictEqual(design.placement_sku, "fr");
    assert.strictEqual(design.width_inches, "12");
    assert.strictEqual(design.height_inches, "7.9");
    assert.match(design.design_link, /print-01-ember-rider\.png$/);
    assert.strictEqual(design.mockup_link, "https://www.ascendtheory.in/images/drops/nratlu/shots/flat-ember.webp");
    assert.strictEqual(payload.shipping_address.first_name, "Shriyansh");
    assert.strictEqual(payload.shipping_address.country_code, "IN");
    assert.strictEqual(payload.shipping_address.phone, "+919876543210");
    delete process.env.QIKINK_FX_TO_INR;
  });

  it("uses the default exchange rate and sandbox Client ID when not configured", () => {
    delete process.env.QIKINK_FX_TO_INR;
    delete process.env.QIKINK_CLIENT_ID;
    delete process.env.QIKINK_ENV;
    assert.strictEqual(qikinkFxToInr(), 95);
    process.env.QIKINK_CLIENT_SECRET = "s";
    assert.strictEqual(getQikinkConfig()?.clientId, "965356474489836");
    assert.strictEqual(getQikinkConfig()?.baseUrl, "https://sandbox.qikink.com");
    delete process.env.QIKINK_CLIENT_SECRET;
  });

  it("auto-sends paid orders only in live mode unless overridden", () => {
    delete process.env.QIKINK_AUTO_SUBMIT;
    delete process.env.QIKINK_ENV;
    assert.strictEqual(qikinkAutoSubmitEnabled(), false);
    process.env.QIKINK_ENV = "live";
    assert.strictEqual(qikinkAutoSubmitEnabled(), true);
    process.env.QIKINK_AUTO_SUBMIT = "false";
    assert.strictEqual(qikinkAutoSubmitEnabled(), false);
    process.env.QIKINK_ENV = "sandbox";
    process.env.QIKINK_AUTO_SUBMIT = "true";
    assert.strictEqual(qikinkAutoSubmitEnabled(), true);
    delete process.env.QIKINK_AUTO_SUBMIT;
    delete process.env.QIKINK_ENV;
  });
});
