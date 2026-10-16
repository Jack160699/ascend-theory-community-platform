import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyRazorpayCheckoutSignature,
} from "../crypto.js";
import {
  createRazorpayCheckout,
  verifyRazorpayCheckoutCallback,
  handleRazorpayWebhook,
} from "../razorpay.js";
import {
  capturePaymentAuthoritatively,
  hasProcessedProviderEvent,
} from "../store-payments.js";
import { saveOrder, getOrder } from "../../orders/store.js";
import { buildOrderFromInput } from "../../orders/build-order.js";
import { confirmOrderPaid } from "../../orders/create-order.js";
import { submitOrderForFulfillment } from "../../fulfillment/index.js";
import type { Order } from "../../orders/types.js";

const TEST_KEY_ID = "rzp_test_key_12345";
const TEST_KEY_SECRET = "test_razorpay_secret_key_123456789";
const TEST_WEBHOOK_SECRET = "test_razorpay_webhook_secret_987654321";

describe("Phase 3 Secure Razorpay Payments Real Failure Mode Tests", () => {
  it("rejects forged or tampered checkout signatures", () => {
    const validParams = {
      razorpay_order_id: "order_Kxyz1234567890",
      razorpay_payment_id: "pay_Kabc9876543210",
      razorpay_signature: "",
    };

    const validSignature = crypto
      .createHmac("sha256", TEST_KEY_SECRET)
      .update(`${validParams.razorpay_order_id}|${validParams.razorpay_payment_id}`)
      .digest("hex");

    validParams.razorpay_signature = validSignature;

    assert.strictEqual(
      verifyRazorpayCheckoutSignature(validParams, TEST_KEY_SECRET),
      true
    );

    const forgedParams = {
      ...validParams,
      razorpay_signature: "forged_signature_1234567890abcdef1234567890abcdef",
    };

    assert.strictEqual(
      verifyRazorpayCheckoutSignature(forgedParams, TEST_KEY_SECRET),
      false
    );
  });

  it("fails closed when Razorpay key ID or key secret is missing in callback verification", async () => {
    const origKeyId = process.env.RAZORPAY_KEY_ID;
    const origKeySecret = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    try {
      const resKeyIdMissing = await verifyRazorpayCheckoutCallback({
        ascendOrderId: "ORD-NOKEY-1",
        razorpayOrderId: "order_1",
        razorpayPaymentId: "pay_1",
        razorpaySignature: "sig_1",
      });

      assert.strictEqual(resKeyIdMissing.ok, false);
      assert.strictEqual(resKeyIdMissing.error, "Razorpay secret credentials unconfigured");
      assert.strictEqual(resKeyIdMissing.status, 500);
    } finally {
      if (origKeyId) process.env.RAZORPAY_KEY_ID = origKeyId;
      if (origKeySecret) process.env.RAZORPAY_KEY_SECRET = origKeySecret;
    }
  });

  it("rejects callback when provider REST API fetch fails", async () => {
    const origKeyId = process.env.RAZORPAY_KEY_ID;
    const origKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const origFetch = globalThis.fetch;

    process.env.RAZORPAY_KEY_ID = TEST_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = TEST_KEY_SECRET;

    const mockOrder: Order = {
      id: "ORD-FETCH-FAIL-01",
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 5000,
      items: [],
      customer: {
        fullName: "Fetch Fail",
        email: "fetchfail@example.com",
        phone: "+919999999999",
        address: "123 St",
        city: "Mumbai",
        postalCode: "400001",
        country: "IN",
      },
    };
    await saveOrder(mockOrder);

    const signature = crypto
      .createHmac("sha256", TEST_KEY_SECRET)
      .update("order_RZP_FETCH_FAIL|pay_FETCH_FAIL")
      .digest("hex");

    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 500,
        text: async () => "Internal Razorpay Error",
      } as unknown as Response;
    }) as typeof globalThis.fetch;

    try {
      const result = await verifyRazorpayCheckoutCallback({
        ascendOrderId: "ORD-FETCH-FAIL-01",
        razorpayOrderId: "order_RZP_FETCH_FAIL",
        razorpayPaymentId: "pay_FETCH_FAIL",
        razorpaySignature: signature,
      });

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "Failed to verify payment state with Razorpay API");
      assert.strictEqual(result.status, 502);

      const checkOrder = await getOrder("ORD-FETCH-FAIL-01");
      assert.strictEqual(checkOrder?.status, "pending_payment");
    } finally {
      globalThis.fetch = origFetch;
      if (origKeyId) process.env.RAZORPAY_KEY_ID = origKeyId;
      if (origKeySecret) process.env.RAZORPAY_KEY_SECRET = origKeySecret;
    }
  });

  it("rejects callback when provider payment status is uncaptured (e.g. created/failed)", async () => {
    const origKeyId = process.env.RAZORPAY_KEY_ID;
    const origKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const origFetch = globalThis.fetch;

    process.env.RAZORPAY_KEY_ID = TEST_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = TEST_KEY_SECRET;

    const mockOrder: Order = {
      id: "ORD-UNCAPTURED-01",
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 5000,
      items: [],
      customer: {
        fullName: "Uncaptured Test",
        email: "uncaptured@example.com",
        phone: "+919999999999",
        address: "123 St",
        city: "Mumbai",
        postalCode: "400001",
        country: "IN",
      },
    };
    await saveOrder(mockOrder);

    const signature = crypto
      .createHmac("sha256", TEST_KEY_SECRET)
      .update("order_RZP_UNCAPTURED|pay_FAILED_STATUS")
      .digest("hex");

    globalThis.fetch = (async () => {
      return {
        ok: true,
        json: async () => ({
          id: "pay_FAILED_STATUS",
          order_id: "order_RZP_UNCAPTURED",
          amount: 500000,
          currency: "INR",
          status: "failed",
        }),
      } as unknown as Response;
    }) as typeof globalThis.fetch;

    try {
      const result = await verifyRazorpayCheckoutCallback({
        ascendOrderId: "ORD-UNCAPTURED-01",
        razorpayOrderId: "order_RZP_UNCAPTURED",
        razorpayPaymentId: "pay_FAILED_STATUS",
        razorpaySignature: signature,
      });

      assert.strictEqual(result.ok, false);
      assert.strictEqual("error" in result && typeof result.error === "string" && result.error.includes("not in captured state"), true);

      const checkOrder = await getOrder("ORD-UNCAPTURED-01");
      assert.strictEqual(checkOrder?.status, "pending_payment");
    } finally {
      globalThis.fetch = origFetch;
      if (origKeyId) process.env.RAZORPAY_KEY_ID = origKeyId;
      if (origKeySecret) process.env.RAZORPAY_KEY_SECRET = origKeySecret;
    }
  });

  it("succeeds callback when provider payment is captured", async () => {
    const origKeyId = process.env.RAZORPAY_KEY_ID;
    const origKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const origFetch = globalThis.fetch;

    process.env.RAZORPAY_KEY_ID = TEST_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = TEST_KEY_SECRET;

    const mockOrder: Order = {
      id: "ORD-CAPTURED-01",
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 5000,
      items: [],
      customer: {
        fullName: "Captured Test",
        email: "captured@example.com",
        phone: "+919999999999",
        address: "123 St",
        city: "Mumbai",
        postalCode: "400001",
        country: "IN",
      },
    };
    await saveOrder(mockOrder);

    const signature = crypto
      .createHmac("sha256", TEST_KEY_SECRET)
      .update("order_RZP_CAPTURED|pay_CAPTURED_STATUS")
      .digest("hex");

    globalThis.fetch = (async () => {
      return {
        ok: true,
        json: async () => ({
          id: "pay_CAPTURED_STATUS",
          order_id: "order_RZP_CAPTURED",
          amount: 500000,
          currency: "INR",
          status: "captured",
        }),
      } as unknown as Response;
    }) as typeof globalThis.fetch;

    try {
      const result = await verifyRazorpayCheckoutCallback({
        ascendOrderId: "ORD-CAPTURED-01",
        razorpayOrderId: "order_RZP_CAPTURED",
        razorpayPaymentId: "pay_CAPTURED_STATUS",
        razorpaySignature: signature,
      });

      assert.strictEqual(result.ok, true);

      const checkOrder = await getOrder("ORD-CAPTURED-01");
      assert.strictEqual(checkOrder?.status, "paid");
    } finally {
      globalThis.fetch = origFetch;
      if (origKeyId) process.env.RAZORPAY_KEY_ID = origKeyId;
      if (origKeySecret) process.env.RAZORPAY_KEY_SECRET = origKeySecret;
    }
  });

  it("handles webhook delivery failure window correctly (first delivery fails, retry succeeds, third delivery is idempotent)", async () => {
    const testOrderId = `ORD-RETRY-FAIL-${Date.now()}`;
    const testRzpOrderId = `order_RETRY_${Date.now()}`;
    const rawBodyPayload = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_RETRY_${Date.now()}`,
            order_id: testRzpOrderId,
            amount: 250000,
            currency: "INR",
            notes: { ascendOrderId: testOrderId },
          },
        },
      },
    });

    const originalWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

    try {
      const signature = crypto
        .createHmac("sha256", TEST_WEBHOOK_SECRET)
        .update(rawBodyPayload)
        .digest("hex");

      // 1. Order not created yet -> First delivery fails
      const eventId = `evt_retry_test_${Date.now()}`;
      const failRes = await handleRazorpayWebhook(rawBodyPayload, signature, eventId);
      assert.strictEqual(failRes.ok, false);
      assert.strictEqual((failRes as { error?: string }).error, "Order not found");

      // Verify event is NOT marked processed
      const checkResult = await hasProcessedProviderEvent(eventId);
      assert.strictEqual(checkResult.ok, true);
      assert.strictEqual(checkResult.processed, false);

      // 2. Now save order and retry
      const retryOrder: Order = {
        id: testOrderId,
        createdAt: new Date().toISOString(),
        status: "pending_payment",
        paymentMethod: "online",
        paymentProvider: "razorpay",
        paymentReference: testRzpOrderId,
        currency: "INR",
        subtotal: 2500,
        items: [],
        customer: {
          fullName: "Retry Test",
          email: "retry@example.com",
          phone: "+919999999999",
          address: "123 St",
          city: "Mumbai",
          postalCode: "400001",
          country: "IN",
        },
      };
      await saveOrder(retryOrder);

      const successRes = await handleRazorpayWebhook(rawBodyPayload, signature, eventId);
      assert.strictEqual(successRes.ok, true);

      const checkOrder = await getOrder(testOrderId);
      assert.strictEqual(checkOrder?.status, "paid");

      // 3. Third delivery must return idempotent duplicate success
      const thirdRes = await handleRazorpayWebhook(rawBodyPayload, signature, eventId);
      assert.strictEqual(thirdRes.ok, true);
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });

  it("ensures amount mismatch on webhook does NOT consume provider_event_id, enabling later corrected retry", async () => {
    const mismatchPayload = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_MISMATCH_RETRY_99",
            order_id: "order_MISMATCH_RETRY_123",
            amount: 100000, // Mismatch! Expected 500000
            currency: "INR",
            notes: { ascendOrderId: "ORD-MISMATCH-RETRY-01" },
          },
        },
      },
    });

    const originalWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

    try {
      const signature = crypto
        .createHmac("sha256", TEST_WEBHOOK_SECRET)
        .update(mismatchPayload)
        .digest("hex");

      const order: Order = {
        id: "ORD-MISMATCH-RETRY-01",
        createdAt: new Date().toISOString(),
        status: "pending_payment",
        paymentMethod: "online",
        paymentProvider: "razorpay",
        paymentReference: "order_MISMATCH_RETRY_123",
        currency: "INR",
        subtotal: 5000,
        items: [],
        customer: {
          fullName: "Mismatch Test",
          email: "mismatch@example.com",
          phone: "+919999999999",
          address: "123 St",
          city: "Mumbai",
          postalCode: "400001",
          country: "IN",
        },
      };
      await saveOrder(order);

      const eventId = "evt_mismatch_retry_999";
      const result = await handleRazorpayWebhook(mismatchPayload, signature, eventId);
      assert.strictEqual(result.ok, false);
      assert.strictEqual((result as { error?: string }).error, "Amount mismatch");

      // Verify event is NOT marked processed
      const checkResult = await hasProcessedProviderEvent(eventId);
      assert.strictEqual(checkResult.ok, true);
      assert.strictEqual(checkResult.processed, false);
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });

  it("rejects amount mismatch between Ascend total and provider amount", async () => {
    const mockOrder: Order = {
      id: "ORD-AMT-REAL-01",
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 5000,
      items: [],
      customer: {
        fullName: "Amount Real Test",
        email: "amt@example.com",
        phone: "+919999999999",
        address: "123 St",
        city: "Delhi",
        postalCode: "110001",
        country: "IN",
      },
    };
    await saveOrder(mockOrder);

    const result = await capturePaymentAuthoritatively({
      ascendOrderId: "ORD-AMT-REAL-01",
      razorpayOrderId: "order_AMT_RZP",
      razorpayPaymentId: "pay_AMT_PAY",
      amountPaise: 100000,
      currency: "INR",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "Amount mismatch");
  });

  it("rejects currency mismatch between Ascend order and provider payment", async () => {
    const mockOrder: Order = {
      id: "ORD-CURR-REAL-01",
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 5000,
      items: [],
      customer: {
        fullName: "Currency Real Test",
        email: "curr@example.com",
        phone: "+919999999999",
        address: "123 St",
        city: "Delhi",
        postalCode: "110001",
        country: "IN",
      },
    };
    await saveOrder(mockOrder);

    const result = await capturePaymentAuthoritatively({
      ascendOrderId: "ORD-CURR-REAL-01",
      razorpayOrderId: "order_CURR_RZP",
      razorpayPaymentId: "pay_CURR_PAY",
      amountPaise: 500000,
      currency: "USD",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "Currency mismatch");
  });

  it("refuses to mark cancelled or refunded orders as paid (terminal state safety)", async () => {
    const cancelledOrder: Order = {
      id: "ORD-TERM-CANCEL-01",
      createdAt: new Date().toISOString(),
      status: "cancelled",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 5000,
      items: [],
      customer: {
        fullName: "Cancelled Customer",
        email: "cancel@example.com",
        phone: "+919999999999",
        address: "123 St",
        city: "Mumbai",
        postalCode: "400001",
        country: "IN",
      },
    };
    await saveOrder(cancelledOrder);

    const resultCancel = await capturePaymentAuthoritatively({
      ascendOrderId: "ORD-TERM-CANCEL-01",
      razorpayOrderId: "order_CANCEL_RZP",
      razorpayPaymentId: "pay_CANCEL_PAY",
      amountPaise: 500000,
      currency: "INR",
    });

    assert.strictEqual(resultCancel.ok, false);
    assert.strictEqual(resultCancel.error, "Cannot process payment for cancelled order");

    const refundedOrder: Order = {
      id: "ORD-TERM-REFUND-01",
      createdAt: new Date().toISOString(),
      status: "refunded",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 5000,
      items: [],
      customer: {
        fullName: "Refunded Customer",
        email: "refund@example.com",
        phone: "+919999999999",
        address: "123 St",
        city: "Mumbai",
        postalCode: "400001",
        country: "IN",
      },
    };
    await saveOrder(refundedOrder);

    const resultRefund = await capturePaymentAuthoritatively({
      ascendOrderId: "ORD-TERM-REFUND-01",
      razorpayOrderId: "order_REFUND_RZP",
      razorpayPaymentId: "pay_REFUND_PAY",
      amountPaise: 500000,
      currency: "INR",
    });

    assert.strictEqual(resultRefund.ok, false);
    assert.strictEqual(resultRefund.error, "Cannot process payment for refunded order");
  });

  it("denies unauthenticated browser confirmOrderPaid without signature", async () => {
    const mockOrder: Order = {
      id: "ORD-SEC-CONFIRM-01",
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 3000,
      items: [],
      customer: {
        fullName: "Test Customer",
        email: "test@ascendtheory.com",
        phone: "+919999999999",
        address: "123 Way",
        city: "Delhi",
        postalCode: "110001",
        country: "IN",
      },
    };

    await saveOrder(mockOrder);

    await assert.rejects(
      async () => {
        await confirmOrderPaid("ORD-SEC-CONFIRM-01");
      },
      (err: Error) => err.message.includes("verified provider signature")
    );

    const orderAfter = await getOrder("ORD-SEC-CONFIRM-01");
    assert.strictEqual(orderAfter?.status, "pending_payment");
  });

  it("ignores order.paid webhook safely without inventing payment IDs", async () => {
    const rawBodyOrderPaid = JSON.stringify({
      event: "order.paid",
      payload: {
        order: {
          entity: {
            id: "order_ORDER_PAID_01",
            amount: 500000,
          },
        },
      },
    });

    const originalWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

    try {
      const signature = crypto
        .createHmac("sha256", TEST_WEBHOOK_SECRET)
        .update(rawBodyOrderPaid)
        .digest("hex");

      const res = await handleRazorpayWebhook(rawBodyOrderPaid, signature, "evt_order_paid_01");
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.message, "order.paid ignored; payment.captured is canonical");
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });

  it("handles webhook payment.captured with x-razorpay-event-id idempotently", async () => {
    const rawBodyPayload = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_WH_REAL_9999",
            order_id: "order_WH_REAL_123",
            amount: 250000,
            currency: "INR",
            notes: { ascendOrderId: "ORD-WH-REAL-001" },
          },
        },
      },
    });

    const originalWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

    try {
      const validSignature = crypto
        .createHmac("sha256", TEST_WEBHOOK_SECRET)
        .update(rawBodyPayload)
        .digest("hex");

      const whOrder: Order = {
        id: "ORD-WH-REAL-001",
        createdAt: new Date().toISOString(),
        status: "pending_payment",
        paymentMethod: "online",
        paymentProvider: "razorpay",
        paymentReference: "order_WH_REAL_123",
        currency: "INR",
        subtotal: 2500,
        items: [],
        customer: {
          fullName: "Webhook Real Test",
          email: "wh@ascendtheory.com",
          phone: "+919999999999",
          address: "456 Test Street",
          city: "Bengaluru",
          postalCode: "560001",
          country: "IN",
        },
      };
      await saveOrder(whOrder);

      const eventId = "evt_razorpay_unique_real_123";
      const validResult = await handleRazorpayWebhook(rawBodyPayload, validSignature, eventId);
      assert.strictEqual(validResult.ok, true);

      const orderAfterWH = await getOrder("ORD-WH-REAL-001");
      assert.strictEqual(orderAfterWH?.status, "paid");
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });

  it("ensures failed payments do not mark order as paid", async () => {
    const rawBodyFailed = JSON.stringify({
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: "pay_FAIL_001",
            notes: { ascendOrderId: "ORD-FAIL-001" },
            error_code: "BAD_REQUEST_ERROR",
            error_description: "Payment failed by customer",
          },
        },
      },
    });

    const originalWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

    try {
      const signature = crypto
        .createHmac("sha256", TEST_WEBHOOK_SECRET)
        .update(rawBodyFailed)
        .digest("hex");

      const failOrder: Order = {
        id: "ORD-FAIL-001",
        createdAt: new Date().toISOString(),
        status: "pending_payment",
        paymentMethod: "online",
        paymentProvider: "razorpay",
        currency: "INR",
        subtotal: 1500,
        items: [],
        customer: {
          fullName: "Failed Customer",
          email: "fail@example.com",
          phone: "+919999999999",
          address: "789 Fail Rd",
          city: "Pune",
          postalCode: "411001",
          country: "IN",
        },
      };
      await saveOrder(failOrder);

      const res = await handleRazorpayWebhook(rawBodyFailed, signature, "evt_fail_1");
      assert.strictEqual(res.ok, true);

      const checkOrder = await getOrder("ORD-FAIL-001");
      assert.strictEqual(checkOrder?.status, "pending_payment");
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });

  it("prevents refunded payments or unpaid orders from triggering fulfillment", async () => {
    const refundedOrder: Order = {
      id: "ORD-REF-001",
      createdAt: new Date().toISOString(),
      status: "refunded",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 4000,
      items: [],
      customer: {
        fullName: "Refunded Customer",
        email: "refund@example.com",
        phone: "+919999999999",
        address: "100 Refund St",
        city: "Goa",
        postalCode: "403001",
        country: "IN",
      },
    };

    await assert.rejects(
      async () => {
        await submitOrderForFulfillment(refundedOrder);
      },
      (err: Error) => err.message.includes("Cannot submit refunded order")
    );

    const unpaidOrder: Order = {
      id: "ORD-UNPAID-001",
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 4000,
      items: [],
      customer: {
        fullName: "Unpaid Customer",
        email: "unpaid@example.com",
        phone: "+919999999999",
        address: "200 Unpaid St",
        city: "Delhi",
        postalCode: "110002",
        country: "IN",
      },
    };

    await assert.rejects(
      async () => {
        await submitOrderForFulfillment(unpaidOrder);
      },
      (err: Error) => err.message.includes("Cannot submit unpaid order")
    );
  });

  it("rejects client price tampering and computes authoritative server prices", () => {
    const tamperedInput = {
      items: [{ slug: "ascend-jacket", quantity: 2, price: 1 }],
      paymentMethod: "online" as const,
      customer: {
        fullName: "Tamper Test",
        email: "tamper@example.com",
        phone: "+919999999999",
        address: "123 Hacker Street",
        city: "Kolkata",
        postalCode: "700001",
        country: "IN",
      },
    };

    const result = buildOrderFromInput(tamperedInput);
    assert.strictEqual(result.ok, true);

    if (result.ok) {
      assert.strictEqual(result.order.items[0].price, 480);
      assert.strictEqual(result.order.items[0].lineTotal, 960);
      assert.strictEqual(result.order.subtotal, 960);
    }
  });

  it("fails closed in production mode when payment secret credentials are missing", async () => {
    const originalEnvMode = process.env.NODE_ENV;
    const originalKeySecret = process.env.RAZORPAY_KEY_SECRET;

    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.RAZORPAY_KEY_SECRET;

    const testOrder: Order = {
      id: "ORD-PROD-FAIL-01",
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 5000,
      items: [],
      customer: {
        fullName: "Prod Fail Test",
        email: "prodfail@example.com",
        phone: "+919999999999",
        address: "123 Fail St",
        city: "Mumbai",
        postalCode: "400001",
        country: "IN",
      },
    };

    try {
      await assert.rejects(
        async () => {
          await createRazorpayCheckout(testOrder, "https://ascendtheory.com");
        },
        (err: Error) => err.message.includes("Razorpay secret credentials missing in production mode")
      );
    } finally {
      (process.env as Record<string, string>).NODE_ENV = originalEnvMode || "development";
      if (originalKeySecret) process.env.RAZORPAY_KEY_SECRET = originalKeySecret;
    }
  });
});
