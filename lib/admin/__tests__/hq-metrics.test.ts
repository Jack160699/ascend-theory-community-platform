import { describe, it } from "node:test";
import assert from "node:assert";
import { orderStage, toOrderRow } from "../metrics";
import { navItemForPath } from "../nav";
import type { Order } from "../../orders/types";
import type { FulfillmentRecord } from "../../fulfillment/fulfillment-store";

const base: Order = {
  id: "ASCEND-ORD-20261017-AB12",
  createdAt: "2026-10-17T10:00:00Z",
  status: "pending_payment",
  paymentMethod: "online",
  paymentProvider: "razorpay",
  paymentStatus: "unpaid",
  currency: "usd",
  subtotal: 220,
  items: [
    { slug: "nratlu-ember-rider-tee", name: "Ember Rider Tee", dropName: "NRATLU", price: 110, priceDisplay: "$110", quantity: 2, lineTotal: 220, size: "M", color: "black" },
  ],
  customer: {
    fullName: "Test Buyer",
    email: "buyer@example.com",
    phone: "+919999999999",
    address: "1 Road",
    city: "Bhilai",
    state: "Chhattisgarh",
    postalCode: "490001",
    country: "India",
  },
};

const fulfilment = (status: FulfillmentRecord["status"]): FulfillmentRecord => ({
  id: "f1",
  orderId: base.id,
  status,
  attemptCount: 1,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
});

describe("Ascend HQ order stages (real data only)", () => {
  it("classifies unpaid, paid, COD and cancelled orders", () => {
    assert.strictEqual(orderStage(base), "awaiting_payment");
    assert.strictEqual(orderStage({ ...base, paymentStatus: "captured", status: "paid" }), "ready_to_send");
    assert.strictEqual(orderStage({ ...base, isCod: true, codStatus: "COD_OTP_PENDING" }), "cod_review");
    assert.strictEqual(orderStage({ ...base, isCod: true, codStatus: "COD_APPROVED" }), "ready_to_send");
    assert.strictEqual(orderStage({ ...base, status: "cancelled" }), "cancelled");
  });

  it("follows the Qikink fulfilment status once an order is sent", () => {
    const paid = { ...base, paymentStatus: "captured", status: "paid" as const };
    assert.strictEqual(orderStage(paid, fulfilment("SUBMITTED")), "in_production");
    assert.strictEqual(orderStage(paid, fulfilment("IN_TRANSIT")), "shipped");
    assert.strictEqual(orderStage(paid, fulfilment("DELIVERED")), "delivered");
    assert.strictEqual(orderStage(paid, fulfilment("FAILED")), "needs_attention");
    assert.strictEqual(orderStage(paid, fulfilment("RECONCILIATION_REQUIRED")), "needs_attention");
  });

  it("builds an order row with units, currency and ship-to", () => {
    const row = toOrderRow({ ...base, paymentStatus: "captured" }, { ...fulfilment("IN_TRANSIT"), trackingNumber: "AWB9" });
    assert.strictEqual(row.units, 2);
    assert.strictEqual(row.currency, "USD");
    assert.strictEqual(row.paymentLabel, "Paid");
    assert.strictEqual(row.trackingNumber, "AWB9");
    assert.match(row.shipTo, /Bhilai, Chhattisgarh, 490001, India/);
  });

  it("titles every HQ page from the navigation", () => {
    assert.strictEqual(navItemForPath("/admin")?.label, "Dashboard");
    assert.strictEqual(navItemForPath("/admin/orders")?.label, "Orders");
    assert.strictEqual(navItemForPath("/admin/wearables/pod-mapping")?.label, "Qikink SKUs");
    assert.strictEqual(navItemForPath("/admin/commerce/cod")?.label, "Cash on delivery");
  });
});
