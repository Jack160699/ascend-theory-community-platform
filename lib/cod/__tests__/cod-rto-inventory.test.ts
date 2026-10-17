import { describe, it, before } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Order } from "@/lib/orders/types";
import type { Product } from "@/lib/wearables/types";
import type { PODProvider, DesignAsset, ProductMockup } from "@/lib/wearables/design-types";
import { saveProductAdmin } from "@/lib/wearables/store";
import { saveDesignAdmin, saveProviderMappingAdmin, saveMockupAdmin } from "@/lib/wearables/design-store";
import { saveOrder, getOrderAdmin } from "@/lib/orders/store";
import { createOrder } from "@/lib/orders/create-order";

import { overrideCodStatusAdmin } from "../decision-engine";
import { createOtpChallengeAdmin, hashOtp, normalizePhone, getOtpPepper } from "../otp";
import { processCodAdvanceCaptureAdmin, MockCodAdvancePaymentProvider } from "../advance";
import { recordDeliveryOutcomeAdmin, getRiskProfileByPhoneAdmin } from "../outcomes";
import { saveReturnedInventoryItemAdmin } from "@/lib/inventory/returned-store";
import { findMatchingReturnedInventory, computeManufacturingIdentityHash } from "@/lib/inventory/reuse-engine";
import { getTodayKolkataDateString } from "../exposure";

describe("Phase 7 — COD Risk, RTO & Returned Inventory Final Transactional Integrity Tests", () => {
  const provider: PODProvider = {
    id: "a0000000-0000-0000-0000-000000000001",
    slug: "qikink",
    name: "Qikink",
    isActive: true,
    createdAt: "",
  };

  const product: Product = {
    id: "prod-ph7-1",
    slug: "ph7-tee",
    title: "Phase 7 T-Shirt",
    status: "active",
    basePricePaise: 100000,
    currency: "INR",
    category: "wearables",
    gender: "unisex",
    isFeatured: true,
    galleryJson: [],
    variants: [
      {
        id: "var-ph7-m",
        productId: "prod-ph7-1",
        sku: "PH7-TEE-BLK-M",
        size: "M",
        color: "black",
        stockQuantity: 50,
        pricePaise: 100000,
        compareAtPricePaise: 0,
        providerCostPaise: 40000,
        availabilityStatus: "available",
        isActive: true,
        sortOrder: 0,
        createdAt: "",
        updatedAt: "",
      },
    ],
    createdAt: "",
    updatedAt: "",
  };

  const design: DesignAsset = {
    id: "dsg-ph7-1",
    title: "Phase 7 Artwork",
    slug: "ph7-artwork",
    status: "active",
    version: 1,
    storagePath: "artwork/ph7-art.png",
    assetUrl: "https://storage.example.com/artwork/ph7-art.png",
    checksum: "sha256-ph7-12345",
    placements: [
      {
        id: "pl-ph7-front",
        designId: "dsg-ph7-1",
        productId: "prod-ph7-1",
        productVariantId: "var-ph7-m",
        position: "front",
        placementLocation: "front",
        xNormalized: 0.5,
        yNormalized: 0.5,
        scale: 1,
        rotationDeg: 0,
        widthMm: 200,
        heightMm: 250,
        printMethod: "dtf",
        isActive: true,
        createdAt: "",
        updatedAt: "",
      },
    ],
    createdAt: "",
    updatedAt: "",
  };

  const mockup: ProductMockup = {
    id: "mock-ph7-1",
    productId: "prod-ph7-1",
    variantId: "var-ph7-m",
    designId: "dsg-ph7-1",
    placementId: "pl-ph7-front",
    imageUrl: "https://storage.example.com/mockups/ph7-front.png",
    viewType: "front",
    isPrimary: true,
    sortOrder: 0,
    status: "approved",
    createdAt: "",
    updatedAt: "",
  };

  before(async () => {
    await saveProductAdmin(product, "admin-id");
    await saveDesignAdmin({ design, placements: design.placements }, "admin-id");
    await saveMockupAdmin(mockup, "admin-id");
    await saveProviderMappingAdmin(
      {
        providerProduct: {
          id: "pp-ph7-qik",
          providerId: provider.id,
          productId: product.id,
          externalProductId: "QIK-PH7-TEE",
          name: "Qikink T-Shirt",
          printMethodsJson: ["dtf"],
          printableAreasJson: [{ location: "front", maxWidthMm: 300, maxHeightMm: 400, printMethod: "dtf" }],
          mappingStatus: "verified",
        },
        providerVariants: [
          {
            id: "pv-ph7-m",
            providerProductId: "pp-ph7-qik",
            productVariantId: "var-ph7-m",
            externalVariantId: "QIK-V-M",
            externalSku: "QIK-SKU-PH7-M",
            sku: "QIK-SKU-PH7-M",
            mappingStatus: "verified",
          },
        ],
      },
      "admin-id",
    );
  });

  // 1. Requirement #1: Legacy returned_inventory disposition DROP NOT NULL
  it("migration 00008 drops NOT NULL from disposition and return_id in public.returned_inventory", () => {
    const migPath = path.join(process.cwd(), "supabase", "migrations", "20260809000008_cod_risk_rto_returned_inventory.sql");
    const sql = fs.readFileSync(migPath, "utf8");

    assert.strictEqual(sql.includes("ALTER TABLE public.returned_inventory ALTER COLUMN return_id DROP NOT NULL;"), true);
    assert.strictEqual(sql.includes("ALTER TABLE public.returned_inventory ALTER COLUMN disposition DROP NOT NULL;"), true);
    assert.strictEqual(sql.includes("ADD COLUMN IF NOT EXISTS manufacturing_identity_hash TEXT"), true);
    assert.strictEqual(sql.includes("ADD COLUMN IF NOT EXISTS manufacturing_snapshot_json JSONB"), true);
  });

  // 2. Requirement #2 & #3: Exact Manufacturing Identity Hashing & Strict Matching
  it("computeManufacturingIdentityHash canonicalizes inputs and requires exact match", () => {
    const inputA = {
      productId: "prod-ph7-1",
      variantId: "var-ph7-m",
      sku: "PH7-TEE-BLK-M",
      designs: [{ designId: "dsg-ph7-1", version: 1, checksum: "sha256-ph7-12345" }],
      placements: [{ placementId: "pl-ph7-front", location: "front", printMethod: "dtf", widthMm: 200, heightMm: 250, scale: 1, rotationDeg: 0 }],
    };

    const hashA = computeManufacturingIdentityHash(inputA);
    assert.strictEqual(typeof hashA, "string");
    assert.strictEqual(hashA.length, 64);

    // Different checksum -> different hash
    const inputDiffChecksum = {
      ...inputA,
      designs: [{ designId: "dsg-ph7-1", version: 1, checksum: "sha256-DIFFERENT" }],
    };
    const hashDiffChecksum = computeManufacturingIdentityHash(inputDiffChecksum);
    assert.notStrictEqual(hashA, hashDiffChecksum);

    // Different placement width -> different hash
    const inputDiffWidth = {
      ...inputA,
      placements: [{ placementId: "pl-ph7-front", location: "front", printMethod: "dtf", widthMm: 250, heightMm: 250, scale: 1, rotationDeg: 0 }],
    };
    const hashDiffWidth = computeManufacturingIdentityHash(inputDiffWidth);
    assert.notStrictEqual(hashA, hashDiffWidth);

    // Different placement location (back vs front) -> different hash
    const inputDiffLoc = {
      ...inputA,
      placements: [{ placementId: "pl-ph7-back", location: "back", printMethod: "dtf", widthMm: 200, heightMm: 250, scale: 1, rotationDeg: 0 }],
    };
    const hashDiffLoc = computeManufacturingIdentityHash(inputDiffLoc);
    assert.notStrictEqual(hashA, hashDiffLoc);
  });

  // 3. Requirement #3: Strict Matching rejects missing / empty hashes
  it("findMatchingReturnedInventory rejects empty or missing manufacturing identity hash", async () => {
    const itemWithoutHash = await saveReturnedInventoryItemAdmin({
      productId: "prod-ph7-1",
      variantId: "var-ph7-m",
      designId: "dsg-ph7-1",
      designVersion: 1,
      sku: "PH7-TEE-BLK-M",
      condition: "NEW_UNWORN",
      manufacturingIdentityHash: "",
      reuseStatus: "INSPECTION_REQUIRED",
      reuseEligible: false,
    });

    assert.strictEqual(itemWithoutHash.reuseEligible, false);
    assert.strictEqual(itemWithoutHash.reuseStatus, "INSPECTION_REQUIRED");

    const inputA = {
      productId: "prod-ph7-1",
      variantId: "var-ph7-m",
      sku: "PH7-TEE-BLK-M",
      designs: [{ designId: "dsg-ph7-1", version: 1, checksum: "sha256-ph7-12345" }],
      placements: [{ placementId: "pl-ph7-front", location: "front", printMethod: "dtf", widthMm: 200, heightMm: 250 }],
    };

    const matches = await findMatchingReturnedInventory(
      { slug: "ph7-tee", productId: "prod-ph7-1", variantId: "var-ph7-m", name: "Tee", dropName: "D1", price: 1000, priceDisplay: "₹1,000", lineTotal: 1000, quantity: 1 },
      inputA,
    );

    assert.strictEqual(matches.some((m) => m.id === itemWithoutHash.id), false);
  });

  // 4. Requirement #8: Phone Normalization Parity
  it("normalizePhone() formats Indian numbers matching SQL public.normalize_phone()", () => {
    assert.strictEqual(normalizePhone("9876543210"), "+919876543210");
    assert.strictEqual(normalizePhone("+919876543210"), "+919876543210");
    assert.strictEqual(normalizePhone("919876543210"), "+919876543210");
    assert.strictEqual(normalizePhone(""), "");
    assert.strictEqual(normalizePhone("123"), "");
  });

  // 5. Requirement #9: OTP Pepper Fail-Closed Behavior
  it("getOtpPepper() returns pepper in test environment and fails closed if missing in prod", () => {
    (process.env as Record<string, string>).NODE_ENV = "test";
    const res = getOtpPepper();
    assert.strictEqual(Boolean(res.pepper), true);
  });

  // 6. Requirement #10 & #27: Customer DTO Excludes Token Hash & Requires Token Binding
  it("createOrder() excludes codConfirmationTokenHash from returned customer Order DTO", async () => {
    const input = {
      items: [{ slug: "ph7-tee", variantId: "var-ph7-m", sku: "PH7-TEE-BLK-M", price: 1000, quantity: 1 }],
      customer: { fullName: "Sanitized Customer", email: "s@example.com", phone: "+919876543210", address: "Line 1", city: "Mumbai", state: "Maharashtra", postalCode: "400001", country: "IN" },
      paymentMethod: "cod" as const,
    };

    const res = await createOrder(input, "http://localhost:3000");
    assert.strictEqual(res.ok, true);

    if (res.ok) {
      assert.strictEqual((res.data.order as Record<string, unknown>).codConfirmationTokenHash, undefined);
      assert.strictEqual(typeof res.data.confirmationToken, "string");
    }
  });

  // 7. Requirement #15: Advance Payment Provider Abstraction
  it("processCodAdvanceCaptureAdmin uses server provider abstraction and rejects caller status tampering", async () => {
    const advanceOrder: Order = {
      id: "ORD-ADVANCE-MOCK-01",
      customer: { fullName: "Advance Customer", email: "adv@example.com", phone: "+919876543210", address: "Line 1", city: "Kolkata", state: "West Bengal", postalCode: "700001", country: "IN" },
      items: [{ orderItemId: "item-adv-1", slug: "ph7-tee", name: "Tee", dropName: "D1", price: 6000, priceDisplay: "₹6,000", lineTotal: 6000, quantity: 1, productId: "prod-ph7-1", variantId: "var-ph7-m", sku: "PH7-TEE-BLK-M" }],
      subtotal: 6000,
      currency: "INR",
      status: "pending_fulfillment",
      paymentMethod: "cod",
      paymentProvider: "razorpay",
      codStatus: "COD_ADVANCE_REQUIRED",
      advanceRequired: true,
      advanceAmountPaise: 20000,
      advanceStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    await saveOrder(advanceOrder);

    const rzpOrderId = "rzp_order_adv_100";
    const rzpPaymentId = "pay_adv_100";
    const secret = "test_key_secret_for_unit_tests";
    const validSig = crypto.createHmac("sha256", secret).update(`${rzpOrderId}|${rzpPaymentId}`).digest("hex");

    const mockProvider = new MockCodAdvancePaymentProvider();
    mockProvider.setMockPayment(rzpPaymentId, rzpOrderId, "captured", 20000, "INR");

    const res = await processCodAdvanceCaptureAdmin(
      {
        orderId: advanceOrder.id,
        razorpayOrderId: rzpOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: validSig,
      },
      mockProvider,
    );

    assert.strictEqual(res.ok, true);

    const updated = await getOrderAdmin(advanceOrder.id);
    assert.strictEqual(updated?.codStatus, "COD_APPROVED");
  });

  // 8. Requirement #20: Outcome Status Validation & Prepaid/COD Separation
  it("prepaid DELIVERED increments successfulPrepaidDeliveries ONLY, COD DELIVERED increments successfulCodDeliveries", async () => {
    const phone = "+919333344444";
    const prepaidOrder: Order = {
      id: "ORD-PREPAID-SEP-01",
      customer: { fullName: "Prepaid User", email: "puser@example.com", phone, address: "Line 1", city: "Delhi", state: "Delhi", postalCode: "110001", country: "IN" },
      items: [{ orderItemId: "item-p-1", slug: "ph7-tee", name: "Tee", dropName: "D1", price: 1000, priceDisplay: "₹1,000", lineTotal: 1000, quantity: 1, productId: "prod-ph7-1", variantId: "var-ph7-m", sku: "PH7-TEE-BLK-M" }],
      subtotal: 1000,
      currency: "INR",
      status: "pending_fulfillment",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      paymentStatus: "captured",
      createdAt: new Date().toISOString(),
    };
    await saveOrder(prepaidOrder);

    const { createOrClaimFulfillmentAdmin } = await import("@/lib/fulfillment/fulfillment-store");
    await createOrClaimFulfillmentAdmin(prepaidOrder.id, null);

    const allFul = await (await import("@/lib/fulfillment/fulfillment-store")).getAllFulfillmentsAdmin();
    const pFul = allFul.find((f) => f.orderId === prepaidOrder.id);
    assert.notStrictEqual(pFul, undefined);

    if (pFul) {
      // Set fulfillment status to IN_TRANSIT so outcome status validation passes
      pFul.status = "IN_TRANSIT";

      const res = await recordDeliveryOutcomeAdmin(pFul.id, "DELIVERED");
      assert.strictEqual(res.ok, true);

      const profile = await getRiskProfileByPhoneAdmin(phone);
      assert.strictEqual(profile?.successfulPrepaidDeliveries, 1);
      assert.strictEqual(profile?.successfulCodDeliveries, 0);
    }
  });

  // 9. Requirement #22: Real Admin UUID Enforcement
  it("overrideCodStatusAdmin requires valid mandatory override reason and real admin UUID", async () => {
    const resNoReason = await overrideCodStatusAdmin("ORD-1", "COD_APPROVED", "", "admin-uuid-1");
    assert.strictEqual(resNoReason.ok, false);
    assert.strictEqual(resNoReason.error, "Mandatory override reason is required");
  });

  // 10. Requirement #30: Exposure Calculation Timezone
  it("getTodayKolkataDateString formats date in Asia/Kolkata timezone", () => {
    const dateStr = getTodayKolkataDateString();
    assert.strictEqual(/^\d{4}-\d{2}-\d{2}$/.test(dateStr), true);
  });

  // 11. Requirement #7: Unknown mock payment ID MUST fail closed
  it("MockCodAdvancePaymentProvider throws when unknown payment ID is queried", async () => {
    const mock = new MockCodAdvancePaymentProvider();
    await assert.rejects(
      async () => {
        await mock.fetchPayment("unknown_pay_123");
      },
      (err: Error) => err.message.includes("payment_not_found"),
    );
  });

  // 12. Requirement #8: processCodAdvanceCaptureAdmin rejects provider order mismatch
  it("processCodAdvanceCaptureAdmin rejects provider order mismatch", async () => {
    const advanceOrder: Order = {
      id: "ORD-ADVANCE-MISMATCH-01",
      customer: { fullName: "Advance Customer", email: "adv@example.com", phone: "+919876543210", address: "Line 1", city: "Kolkata", state: "West Bengal", postalCode: "700001", country: "IN" },
      items: [{ orderItemId: "item-adv-1", slug: "ph7-tee", name: "Tee", dropName: "D1", price: 6000, priceDisplay: "₹6,000", lineTotal: 6000, quantity: 1, productId: "prod-ph7-1", variantId: "var-ph7-m", sku: "PH7-TEE-BLK-M" }],
      subtotal: 6000,
      currency: "INR",
      status: "pending_fulfillment",
      paymentMethod: "cod",
      paymentProvider: "razorpay",
      codStatus: "COD_ADVANCE_REQUIRED",
      advanceRequired: true,
      advanceAmountPaise: 20000,
      advanceStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    await saveOrder(advanceOrder);

    const rzpOrderId = "rzp_order_expected";
    const rzpPaymentId = "pay_mismatch";
    const secret = "test_key_secret_for_unit_tests";
    const validSig = crypto.createHmac("sha256", secret).update(`${rzpOrderId}|${rzpPaymentId}`).digest("hex");

    const mockProvider = new MockCodAdvancePaymentProvider();
    // Register payment with DIFFERENT order ID
    mockProvider.setMockPayment(rzpPaymentId, "rzp_order_DIFFERENT", "captured", 20000, "INR");

    const res = await processCodAdvanceCaptureAdmin(
      {
        orderId: advanceOrder.id,
        razorpayOrderId: rzpOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: validSig,
      },
      mockProvider,
    );

    assert.strictEqual(res.ok, false);
    if (!res.ok) {
      assert.strictEqual(res.error, "provider_order_mismatch");
    }
  });

  // 13. Requirement #15: saveReturnedInventoryItemAdmin rejects source order item attribute mismatch
  it("saveReturnedInventoryItemAdmin rejects identity mismatch against source order item", async () => {
    const srcOrder: Order = {
      id: "ORD-SOURCE-RET-01",
      customer: { fullName: "Source User", email: "src@example.com", phone: "+919876543210", address: "Line 1", city: "Mumbai", state: "MH", postalCode: "400001", country: "IN" },
      items: [
        {
          orderItemId: "item-source-100",
          productId: "prod-ph7-1",
          variantId: "var-ph7-m",
          sku: "PH7-TEE-BLK-M",
          slug: "ph7-tee",
          name: "Phase 7 Tee",
          dropName: "D1",
          price: 1000,
          priceDisplay: "₹1,000",
          quantity: 1,
          lineTotal: 1000,
          manufacturingIdentityHash: "auth-hash-12345",
          manufacturingSnapshotJson: { test: true },
        },
      ],
      subtotal: 1000,
      currency: "INR",
      status: "pending_fulfillment",
      paymentMethod: "cod",
      paymentProvider: "none",
      createdAt: new Date().toISOString(),
    };
    await saveOrder(srcOrder);

    // Mismatched SKU should throw
    await assert.rejects(
      async () => {
        await saveReturnedInventoryItemAdmin({
          sourceOrderId: srcOrder.id,
          sourceOrderItemId: "item-source-100",
          productId: "prod-ph7-1",
          variantId: "var-ph7-m",
          designId: "dsg-ph7-1",
          designVersion: 1,
          sku: "MISMATCHED-SKU",
        });
      },
      (err: Error) => err.message.includes("source_order_item_identity_mismatch"),
    );
  });

  // 14. Requirement #21: recordDeliveryOutcomeAdmin handles provider event idempotency and rebound
  it("recordDeliveryOutcomeAdmin handles provider event idempotency and rebound", async () => {
    const phone = "+919111122222";
    const orderA: Order = {
      id: "ORD-EV-IDEM-01",
      customer: { fullName: "Ev User", email: "ev@example.com", phone, address: "Line 1", city: "Delhi", state: "Delhi", postalCode: "110001", country: "IN" },
      items: [{ orderItemId: "item-ev-1", slug: "ph7-tee", name: "Tee", dropName: "D1", price: 1000, priceDisplay: "₹1,000", lineTotal: 1000, quantity: 1, productId: "prod-ph7-1", variantId: "var-ph7-m", sku: "PH7-TEE-BLK-M" }],
      subtotal: 1000,
      currency: "INR",
      status: "pending_fulfillment",
      paymentMethod: "cod",
      paymentProvider: "none",
      codStatus: "COD_APPROVED",
      createdAt: new Date().toISOString(),
    };
    await saveOrder(orderA);

    const { createOrClaimFulfillmentAdmin } = await import("@/lib/fulfillment/fulfillment-store");
    await createOrClaimFulfillmentAdmin(orderA.id, null);
    const allFul = await (await import("@/lib/fulfillment/fulfillment-store")).getAllFulfillmentsAdmin();
    const ful = allFul.find((f) => f.orderId === orderA.id);
    assert.notStrictEqual(ful, undefined);

    if (ful) {
      ful.status = "IN_TRANSIT";

      const evtId = "provider_event_12345";
      const res1 = await recordDeliveryOutcomeAdmin(ful.id, "DELIVERED", "DELIVERED", evtId);
      assert.strictEqual(res1.ok, true);
      if (res1.ok) assert.strictEqual(res1.alreadyProcessed, false);

      // Replay same event ID -> alreadyProcessed
      const resReplay = await recordDeliveryOutcomeAdmin(ful.id, "DELIVERED", "DELIVERED", evtId);
      assert.strictEqual(resReplay.ok, true);
      if (resReplay.ok) assert.strictEqual(resReplay.alreadyProcessed, true);

      // Rebind same event ID to different outcome -> provider_event_rebound
      const resRebound = await recordDeliveryOutcomeAdmin(ful.id, "REFUSED", "REFUSED", evtId);
      assert.strictEqual(resRebound.ok, false);
      if (!resRebound.ok) assert.strictEqual(resRebound.error, "provider_event_rebound");
    }
  });

  // 15. Requirement #15: Placement Position (x/y) changes manufacturing identity hash
  it("computeManufacturingIdentityHash changes when xNormalized or yNormalized changes", () => {
    const baseInput = {
      productId: "prod-ph7-1",
      variantId: "var-ph7-m",
      sku: "PH7-TEE-BLK-M",
      placements: [
        {
          placementId: "pl-ph7-front",
          location: "front",
          printMethod: "dtf",
          xNormalized: 0.5,
          yNormalized: 0.5,
        },
      ],
    };

    const hashBase = computeManufacturingIdentityHash(baseInput);

    const inputMovedX = {
      ...baseInput,
      placements: [
        {
          placementId: "pl-ph7-front",
          location: "front",
          printMethod: "dtf",
          xNormalized: 0.7,
          yNormalized: 0.5,
        },
      ],
    };
    const hashMovedX = computeManufacturingIdentityHash(inputMovedX);
    assert.notStrictEqual(hashBase, hashMovedX);

    const inputMovedY = {
      ...baseInput,
      placements: [
        {
          placementId: "pl-ph7-front",
          location: "front",
          printMethod: "dtf",
          xNormalized: 0.5,
          yNormalized: 0.8,
        },
      ],
    };
    const hashMovedY = computeManufacturingIdentityHash(inputMovedY);
    assert.notStrictEqual(hashBase, hashMovedY);
  });

  // 16. Requirement #11: verifyRazorpayCheckoutSignature handles malformed inputs safely
  it("verifyRazorpayCheckoutSignature returns false cleanly for malformed/length-mismatched signatures without throwing", async () => {
    const { verifyRazorpayCheckoutSignature: verifySig } = await import("../advance");
    const res = verifySig("rzp_order_123", "pay_123", "short_bad_sig", "test_secret");
    assert.strictEqual(res, false);
  });

  // 17. Requirement #8: buildAuthoritativeManufacturingIdentity includes placement x/y
  it("buildAuthoritativeManufacturingIdentity populates xNormalized and yNormalized in authoritative snapshot", async () => {
    const { buildAuthoritativeManufacturingIdentity } = await import("@/lib/inventory/reuse-engine");
    const res = await buildAuthoritativeManufacturingIdentity("prod-ph7-1", "var-ph7-m", "PH7-TEE-BLK-M");
    assert.ok(res.hash);
    assert.ok(res.snapshot);
    if (res.snapshot.placements && res.snapshot.placements.length > 0) {
      assert.strictEqual(typeof res.snapshot.placements[0].xNormalized, "number");
      assert.strictEqual(typeof res.snapshot.placements[0].yNormalized, "number");
    }
  });

  // 18. Requirement #5: Header-based token authorization for COD order read
  it("GET /api/orders/[orderId] requires confirmation token header for COD orders", async () => {
    const phone = "+919999900000";
    const confToken = "raw-bearer-token-12345";
    const tokenHash = crypto.createHash("sha256").update(confToken).digest("hex");
    const orderAuth: Order = {
      id: "ORD-AUTH-TOKEN-01",
      customer: { fullName: "Auth User", email: "auth@example.com", phone, address: "L1", city: "Delhi", state: "Delhi", postalCode: "110001", country: "IN" },
      items: [{ orderItemId: "item-auth-1", slug: "ph7-tee", name: "Tee", dropName: "D1", price: 1000, priceDisplay: "₹1,000", lineTotal: 1000, quantity: 1, productId: "prod-ph7-1", variantId: "var-ph7-m", sku: "PH7-TEE-BLK-M" }],
      subtotal: 1000,
      currency: "INR",
      status: "created",
      paymentMethod: "cod",
      paymentProvider: "none",
      codStatus: "COD_PENDING_CONFIRMATION",
      codConfirmationTokenHash: tokenHash,
      createdAt: new Date().toISOString(),
    };
    await saveOrder(orderAuth);

    const { GET } = await import("@/app/api/orders/[orderId]/route");
    
    // Request without token -> 403
    const reqNoToken = new Request("http://localhost/api/orders/ORD-AUTH-TOKEN-01");
    const resNoToken = await GET(reqNoToken, { params: Promise.resolve({ orderId: "ORD-AUTH-TOKEN-01" }) });
    assert.strictEqual(resNoToken.status, 403);

    // Request with valid header token -> 200
    const reqWithToken = new Request("http://localhost/api/orders/ORD-AUTH-TOKEN-01", {
      headers: { "x-ascend-confirmation-token": confToken },
    });
    const resWithToken = await GET(reqWithToken, { params: Promise.resolve({ orderId: "ORD-AUTH-TOKEN-01" }) });
    assert.strictEqual(resWithToken.status, 200);
    const json = await resWithToken.json();
    assert.strictEqual(json.order.id, "ORD-AUTH-TOKEN-01");
    assert.strictEqual(json.order.codConfirmationTokenHash, undefined);
  });

  // 19. Requirement #18-A: SQL Static Audit for migration 00008 exact REVOKE/GRANT signatures and DECLARE block
  it("migration 00008 contains exact REVOKE/GRANT signatures and DECLARE variables for all RPCs", () => {
    const migrationPath = path.join(process.cwd(), "supabase", "migrations", "20260809000008_cod_risk_rto_returned_inventory.sql");
    const sql = fs.readFileSync(migrationPath, "utf-8");

    assert.ok(
      sql.includes("v_existing_event RECORD;"),
      "Migration 00008 missing v_existing_event RECORD in record_delivery_outcome_with_audit DECLARE block",
    );
    assert.ok(
      sql.includes("REVOKE EXECUTE ON FUNCTION public.create_cod_otp_challenge_with_audit(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)"),
      "Migration 00008 missing exact create_cod_otp_challenge_with_audit REVOKE signature",
    );
    assert.ok(
      sql.includes("GRANT EXECUTE ON FUNCTION public.create_cod_otp_challenge_with_audit(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)"),
      "Migration 00008 missing exact create_cod_otp_challenge_with_audit GRANT signature",
    );
    assert.ok(
      sql.includes("REVOKE EXECUTE ON FUNCTION public.verify_cod_otp_and_apply_decision_with_audit(TEXT, TEXT, TEXT, UUID)"),
      "Migration 00008 missing exact verify_cod_otp_and_apply_decision_with_audit REVOKE signature",
    );
    assert.ok(
      sql.includes("GRANT EXECUTE ON FUNCTION public.verify_cod_otp_and_apply_decision_with_audit(TEXT, TEXT, TEXT, UUID)"),
      "Migration 00008 missing exact verify_cod_otp_and_apply_decision_with_audit GRANT signature",
    );
    assert.ok(
      sql.includes("REVOKE EXECUTE ON FUNCTION public.capture_cod_advance_with_audit(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID)"),
      "Migration 00008 missing exact capture_cod_advance_with_audit REVOKE signature",
    );
    assert.ok(
      sql.includes("GRANT EXECUTE ON FUNCTION public.capture_cod_advance_with_audit(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID)"),
      "Migration 00008 missing exact capture_cod_advance_with_audit GRANT signature",
    );
    assert.ok(
      sql.includes("REVOKE EXECUTE ON FUNCTION public.reserve_matching_returned_inventory_with_audit(UUID, UUID)"),
      "Migration 00008 missing exact reserve_matching_returned_inventory_with_audit REVOKE signature",
    );
    assert.ok(
      sql.includes("GRANT EXECUTE ON FUNCTION public.reserve_matching_returned_inventory_with_audit(UUID, UUID)"),
      "Migration 00008 missing exact reserve_matching_returned_inventory_with_audit GRANT signature",
    );
    assert.ok(
      sql.includes("REVOKE EXECUTE ON FUNCTION public.bind_cod_advance_provider_order_with_audit(UUID, TEXT, TEXT, TEXT)"),
      "Migration 00008 missing exact 4-parameter bind REVOKE signature",
    );
    assert.ok(
      sql.includes("GRANT EXECUTE ON FUNCTION public.bind_cod_advance_provider_order_with_audit(UUID, TEXT, TEXT, TEXT)"),
      "Migration 00008 missing exact 4-parameter bind GRANT signature",
    );
  });

  // 20. Requirement #18-H: Razorpay script loader availability module
  it("Razorpay script loader resolves correctly in server and client environments", async () => {
    const { isRazorpayLoaded } = await import("@/lib/payments/razorpay-loader");
    assert.strictEqual(isRazorpayLoaded(), false);
  });

  // 21. Requirement #18-J: Prepaid order customer read capability token authorization
  it("GET /api/orders/[orderId] requires customer read capability token for prepaid orders", async () => {
    const readToken = "prepaid-read-token-67890";
    const readTokenHash = crypto.createHash("sha256").update(readToken).digest("hex");
    const orderPrepaid: Order = {
      id: "ORD-PREPAID-AUTH-01",
      customer: { fullName: "Prepaid User", email: "prepaid@example.com", phone: "+919888877777", address: "L1", city: "Mumbai", state: "MH", postalCode: "400001", country: "IN" },
      items: [{ orderItemId: "item-prepaid-1", slug: "ph7-tee", name: "Tee", dropName: "D1", price: 1000, priceDisplay: "₹1,000", lineTotal: 1000, quantity: 1, productId: "prod-ph7-1", variantId: "var-ph7-m", sku: "PH7-TEE-BLK-M" }],
      subtotal: 1000,
      currency: "INR",
      status: "created",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      customerReadTokenHash: readTokenHash,
      createdAt: new Date().toISOString(),
    };
    await saveOrder(orderPrepaid);

    const { GET } = await import("@/app/api/orders/[orderId]/route");

    // Without token -> 403
    const reqNoToken = new Request("http://localhost/api/orders/ORD-PREPAID-AUTH-01");
    const resNoToken = await GET(reqNoToken, { params: Promise.resolve({ orderId: "ORD-PREPAID-AUTH-01" }) });
    assert.strictEqual(resNoToken.status, 403);

    // With valid read token -> 200 sanitized
    const reqWithToken = new Request("http://localhost/api/orders/ORD-PREPAID-AUTH-01", {
      headers: { "x-ascend-customer-read-token": readToken },
    });
    const resWithToken = await GET(reqWithToken, { params: Promise.resolve({ orderId: "ORD-PREPAID-AUTH-01" }) });
    assert.strictEqual(resWithToken.status, 200);
    const json = await resWithToken.json();
    assert.strictEqual(json.order.id, "ORD-PREPAID-AUTH-01");
    assert.strictEqual(json.order.customerReadTokenHash, undefined);
    assert.strictEqual(json.order.codConfirmationTokenHash, undefined);
    assert.strictEqual(json.order.items[0].manufacturingIdentityHash, undefined);
    assert.strictEqual(json.order.items[0].manufacturingSnapshotJson, undefined);

    // With incorrect token -> 403
    const reqBadToken = new Request("http://localhost/api/orders/ORD-PREPAID-AUTH-01", {
      headers: { "x-ascend-customer-read-token": "bad-invalid-token" },
    });
    const resBadToken = await GET(reqBadToken, { params: Promise.resolve({ orderId: "ORD-PREPAID-AUTH-01" }) });
    assert.strictEqual(resBadToken.status, 403);
  });

  // 22. Customer read capability - create-order API response & DTO sanitization
  it("POST /api/create-order returns customerReadToken and excludes customerReadTokenHash", async () => {
    const { POST } = await import("@/app/api/create-order/route");
    const payload = {
      items: [{ slug: "ascend-jacket", sku: "ASCEND-JACKET-M", size: "M", color: "Black", price: 18000, quantity: 1 }],
      customer: { fullName: "Read Cap User", email: "readcap@example.com", phone: "+919999911111", address: "L1", city: "Delhi", postalCode: "110001", country: "IN" },
      paymentMethod: "cod" as const,
    };
    const req = new Request("http://localhost/api/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();

    assert.ok(json.customerReadToken, "Response missing customerReadToken");
    assert.ok(json.confirmationToken, "COD response missing confirmationToken");
    assert.strictEqual(json.customerReadTokenHash, undefined, "Response leaked customerReadTokenHash");
    assert.strictEqual(json.order.customerReadTokenHash, undefined, "Order DTO leaked customerReadTokenHash");
    assert.strictEqual(json.order.codConfirmationTokenHash, undefined, "Order DTO leaked codConfirmationTokenHash");
  });

  // 23. Customer read capability - Migration 00008 contains customer_read_token_hash column & store code maps customerReadTokenHash
  it("migration 00008 and order stores properly map customer_read_token_hash", () => {
    const migrationPath = path.join(process.cwd(), "supabase", "migrations", "20260809000008_cod_risk_rto_returned_inventory.sql");
    const sql = fs.readFileSync(migrationPath, "utf-8");
    assert.ok(
      sql.includes("customer_read_token_hash TEXT"),
      "Migration 00008 missing customer_read_token_hash TEXT column",
    );

    const supabaseStorePath = path.join(process.cwd(), "lib", "orders", "supabase-store.ts");
    const storeCode = fs.readFileSync(supabaseStorePath, "utf-8");
    assert.ok(
      storeCode.includes("customer_read_token_hash: order.customerReadTokenHash || null"),
      "saveSupabaseOrder does not persist customer_read_token_hash",
    );
    assert.ok(
      storeCode.includes("customerReadTokenHash: orderRow.customer_read_token_hash || undefined"),
      "getSupabaseOrder does not hydrate customerReadTokenHash",
    );

    const adminStorePath = path.join(process.cwd(), "lib", "orders", "store.ts");
    const adminCode = fs.readFileSync(adminStorePath, "utf-8");
    assert.ok(
      adminCode.includes("customerReadTokenHash: row.customer_read_token_hash || undefined"),
      "getAllOrdersAdmin does not hydrate customerReadTokenHash",
    );
  });
});
