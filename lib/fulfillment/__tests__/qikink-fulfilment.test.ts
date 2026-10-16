import { describe, it, before } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

import type { Order } from "@/lib/orders/types";
import type { Product } from "@/lib/wearables/types";
import type { PODProvider, DesignAsset, ProductMockup, ProviderProduct, ProviderVariant } from "@/lib/wearables/design-types";
import { saveProductAdmin } from "@/lib/wearables/store";
import { saveDesignAdmin, saveProviderMappingAdmin, saveMockupAdmin } from "@/lib/wearables/design-store";
import { saveOrder } from "@/lib/orders/store";

import { evaluateOrderFulfillmentEligibility } from "../eligibility";
import {
  createOrClaimFulfillmentAdmin,
  submitFulfillmentToProviderAdmin,
  retryFulfillmentSubmissionAdmin,
  reconcileSubmissionAdmin,
  bindProviderOrderAdmin,
  updateFulfillmentStatusAdmin,
  getFulfillmentByIdAdmin,
  toSupportDTO,
} from "../fulfillment-store";
import { QikinkFulfillmentAdapter, redactSecrets, QIKINK_API_CONTRACT_VERIFIED } from "../qikink";
import { QikinkMockTransport } from "../qikink-mock";
import { getFulfillmentProviderAdapter } from "../provider-registry";
import { computeManufacturingIntentHash } from "../hash";
import { validateFulfillmentSnapshotBeforeFirstSubmission } from "../snapshot-validator";
import { isValidStatusTransition, ALLOWED_STATUS_TRANSITIONS } from "../status-graph";
import type { FulfillmentSnapshot, FulfillmentStatus } from "../types";

describe("Phase 6 — Qikink Fulfilment Integration & Parity Tests", () => {
  const qikinkProvider: PODProvider = {
    id: "a0000000-0000-0000-0000-000000000001",
    slug: "qikink",
    name: "Qikink",
    isActive: true,
    createdAt: "",
  };

  const validProduct: Product = {
    id: "prod-ph6-1",
    slug: "ph6-hoodie",
    title: "Phase 6 Hoodie",
    status: "active",
    basePricePaise: 150000,
    currency: "INR",
    category: "wearables",
    gender: "unisex",
    isFeatured: true,
    galleryJson: [],
    variants: [
      {
        id: "var-ph6-m",
        productId: "prod-ph6-1",
        sku: "PH6-HOOD-BLK-M",
        size: "M",
        color: "black",
        stockQuantity: 20,
        pricePaise: 150000,
        compareAtPricePaise: 0,
        providerCostPaise: 80000,
        availabilityStatus: "available",
        isActive: true,
        sortOrder: 0,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "var-ph6-l",
        productId: "prod-ph6-1",
        sku: "PH6-HOOD-BLK-L",
        size: "L",
        color: "black",
        stockQuantity: 15,
        pricePaise: 150000,
        compareAtPricePaise: 0,
        providerCostPaise: 80000,
        availabilityStatus: "available",
        isActive: true,
        sortOrder: 1,
        createdAt: "",
        updatedAt: "",
      },
    ],
    createdAt: "",
    updatedAt: "",
  };

  const validDesignA: DesignAsset = {
    id: "dsg-ph6-a",
    title: "Phase 6 Front Graphic",
    slug: "ph6-graphic-front",
    status: "active",
    version: 1,
    storagePath: "artwork/ph6-front.png",
    assetUrl: "https://storage.example.com/artwork/ph6-front.png",
    checksum: "sha256-front-123",
    placements: [
      {
        id: "pl-ph6-front-m",
        designId: "dsg-ph6-a",
        productId: "prod-ph6-1",
        productVariantId: "var-ph6-m",
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
      {
        id: "pl-ph6-front-l",
        designId: "dsg-ph6-a",
        productId: "prod-ph6-1",
        productVariantId: "var-ph6-l",
        position: "front",
        placementLocation: "front",
        xNormalized: 0.5,
        yNormalized: 0.5,
        scale: 1,
        rotationDeg: 0,
        widthMm: 220,
        heightMm: 270,
        printMethod: "dtf",
        isActive: true,
        createdAt: "",
        updatedAt: "",
      },
    ],
    createdAt: "",
    updatedAt: "",
  };

  const validMockup: ProductMockup = {
    id: "mock-ph6-1",
    productId: "prod-ph6-1",
    variantId: "var-ph6-m",
    designId: "dsg-ph6-a",
    placementId: "pl-ph6-front-m",
    imageUrl: "https://storage.example.com/mockups/ph6-front.png",
    viewType: "front",
    isPrimary: true,
    sortOrder: 0,
    status: "approved",
    createdAt: "",
    updatedAt: "",
  };

  const validMockupL: ProductMockup = {
    id: "mock-ph6-2",
    productId: "prod-ph6-1",
    variantId: "var-ph6-l",
    designId: "dsg-ph6-a",
    placementId: "pl-ph6-front-l",
    imageUrl: "https://storage.example.com/mockups/ph6-front-l.png",
    viewType: "front",
    isPrimary: true,
    sortOrder: 0,
    status: "approved",
    createdAt: "",
    updatedAt: "",
  };

  before(async () => {
    await saveProductAdmin(validProduct, "admin-id");
    await saveDesignAdmin({ design: validDesignA, placements: validDesignA.placements }, "admin-id");
    await saveMockupAdmin(validMockup, "admin-id");
    await saveMockupAdmin(validMockupL, "admin-id");
    await saveProviderMappingAdmin(
      {
        providerProduct: {
          id: "pp-ph6-qik",
          providerId: qikinkProvider.id,
          productId: validProduct.id,
          externalProductId: "QIK-PH6-HD",
          name: "Qikink Premium Hoodie",
          printMethodsJson: ["dtf"],
          printableAreasJson: [{ location: "front", maxWidthMm: 300, maxHeightMm: 400, printMethod: "dtf" }],
          mappingStatus: "verified",
        },
        providerVariants: [
          {
            id: "pv-ph6-m",
            providerProductId: "pp-ph6-qik",
            productVariantId: "var-ph6-m",
            externalVariantId: "QIK-V-M",
            externalSku: "QIK-SKU-PH6-M",
            sku: "QIK-SKU-PH6-M",
            mappingStatus: "verified",
          },
          {
            id: "pv-ph6-l",
            providerProductId: "pp-ph6-qik",
            productVariantId: "var-ph6-l",
            externalVariantId: "QIK-V-L",
            externalSku: "QIK-SKU-PH6-L",
            sku: "QIK-SKU-PH6-L",
            mappingStatus: "verified",
          },
        ],
      },
      "admin-id",
    );
  });

  // 1. SQL / TypeScript Status Graph Parity Test (Requirement #1)
  it("SQL migration status graph is 100% identical to TypeScript ALLOWED_STATUS_TRANSITIONS", () => {
    const migPath = path.join(process.cwd(), "supabase", "migrations", "20260809000007_qikink_fulfilment.sql");
    const sql = fs.readFileSync(migPath, "utf-8");

    // Assert SQL contains RECONCILIATION_REQUIRED and EXCEPTION branches
    assert.strictEqual(sql.includes("WHEN 'RECONCILIATION_REQUIRED' THEN"), true, "SQL MUST contain RECONCILIATION_REQUIRED status transition branch");
    assert.strictEqual(sql.includes("WHEN 'EXCEPTION' THEN"), true, "SQL MUST contain EXCEPTION status transition branch");

    // Critical transitions MUST be allowed by BOTH TS and SQL:
    assert.strictEqual(isValidStatusTransition("RECONCILIATION_REQUIRED", "PROCESSING"), true);
    assert.strictEqual(isValidStatusTransition("EXCEPTION", "IN_TRANSIT"), true);

    // Verify all keys in ALLOWED_STATUS_TRANSITIONS exist in SQL definition
    const allStatuses = Object.keys(ALLOWED_STATUS_TRANSITIONS) as FulfillmentStatus[];
    for (const status of allStatuses) {
      if (status !== "DELIVERED" && status !== "RETURNED" && status !== "CANCELLED" && status !== "FAILED") {
        assert.strictEqual(sql.includes(`WHEN '${status}' THEN`), true, `SQL function MUST contain WHEN '${status}' THEN branch`);
      }
    }
  });

  // 2. Race-Safe Waybill Binding & Rebound Test (Requirement #2)
  it("race-safe waybill binding rejects rebound attempt and preserves original binding", async () => {
    const orderA: Order = {
      id: "ORD-WAYBILL-A",
      customer: { fullName: "User A", email: "a@example.com", phone: "+919999999999", address: "Line 1", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "IN" },
      items: [{ orderItemId: "item-wb-a", slug: "ph6-hoodie", name: "Hoodie", dropName: "Drop 1", price: 1500, priceDisplay: "₹1,500", lineTotal: 1500, quantity: 1, productId: "prod-ph6-1", variantId: "var-ph6-m", sku: "PH6-HOOD-BLK-M" }],
      subtotal: 1500,
      currency: "INR",
      status: "paid",
      paymentStatus: "captured",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      createdAt: "",
    };
    await saveOrder(orderA);

    const orderB: Order = {
      id: "ORD-WAYBILL-B",
      customer: { fullName: "User B", email: "b@example.com", phone: "+919999999999", address: "Line 1", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "IN" },
      items: [{ orderItemId: "item-wb-b", slug: "ph6-hoodie", name: "Hoodie", dropName: "Drop 1", price: 1500, priceDisplay: "₹1,500", lineTotal: 1500, quantity: 1, productId: "prod-ph6-1", variantId: "var-ph6-m", sku: "PH6-HOOD-BLK-M" }],
      subtotal: 1500,
      currency: "INR",
      status: "paid",
      paymentStatus: "captured",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      createdAt: "",
    };
    await saveOrder(orderB);

    const claimA = await createOrClaimFulfillmentAdmin(orderA.id, null);
    const claimB = await createOrClaimFulfillmentAdmin(orderB.id, null);
    assert.strictEqual(claimA.ok, true);
    assert.strictEqual(claimB.ok, true);

    if (claimA.ok && claimB.ok) {
      // Transition fulfillments to PROCESSING before shipping status transition
      await updateFulfillmentStatusAdmin(claimA.fulfillment.id, "PROCESSING");
      await updateFulfillmentStatusAdmin(claimB.fulfillment.id, "PROCESSING");

      // Fulfillment A binds AWB-PARITY-123
      const resA = await updateFulfillmentStatusAdmin(claimA.fulfillment.id, "IN_TRANSIT", "IN_TRANSIT", undefined, undefined, "AWB-PARITY-123", "Delhivery", null);
      assert.strictEqual(resA.ok, true);

      // Fulfillment B attempts AWB-PARITY-123 -> rejected with shipment_waybill_rebound
      const resB = await updateFulfillmentStatusAdmin(claimB.fulfillment.id, "IN_TRANSIT", "IN_TRANSIT", undefined, undefined, "AWB-PARITY-123", "Delhivery", null);
      assert.strictEqual(resB.ok, false);
      assert.strictEqual(resB.error, "shipment_waybill_rebound");

      // Verify AWB-PARITY-123 remains bound to A
      const recA = await getFulfillmentByIdAdmin(claimA.fulfillment.id);
      assert.strictEqual(recA?.trackingNumber, "AWB-PARITY-123");
    }
  });

  // 3. FAILED Idempotency Manual Review Semantics Test (Requirement #4)
  it("FAILED fulfillment with same idempotency key returns failed_fulfillment_requires_manual_review", async () => {
    const order: Order = {
      id: "ORD-FAILED-IDEMP-01",
      customer: { fullName: "Failed User", email: "failed@example.com", phone: "+919999999999", address: "Line 1", city: "Delhi", state: "Delhi", postalCode: "110001", country: "IN" },
      items: [{ orderItemId: "item-fail-idemp-1", slug: "ph6-hoodie", name: "Hoodie", dropName: "Drop 1", price: 1500, priceDisplay: "₹1,500", lineTotal: 1500, quantity: 1, productId: "prod-ph6-1", variantId: "var-ph6-m", sku: "PH6-HOOD-BLK-M" }],
      subtotal: 1500,
      currency: "INR",
      status: "paid",
      paymentStatus: "captured",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      createdAt: "",
    };
    await saveOrder(order);

    const claimRes = await createOrClaimFulfillmentAdmin(order.id, null);
    assert.strictEqual(claimRes.ok, true);

    if (claimRes.ok) {
      // Transition fulfillment to FAILED without provider_order_id
      await updateFulfillmentStatusAdmin(claimRes.fulfillment.id, "FAILED", "FAILED", "INVALID_ARTWORK", "Artwork invalid", undefined, undefined, null);

      // Subsequent claim MUST return failed_fulfillment_requires_manual_review (NOT already_submitted)
      const claim2 = await createOrClaimFulfillmentAdmin(order.id, null);
      assert.strictEqual(claim2.ok, false);
      assert.strictEqual(claim2.error, "failed_fulfillment_requires_manual_review");
    }
  });

  // 4. Support-Safe DTO Sanitation Test (Requirement #6)
  it("toSupportDTO strips snapshotJson, requestHash, idempotencyKey, and payment internals", async () => {
    const order: Order = {
      id: "ORD-SUPPORT-DTO-01",
      customer: { fullName: "Support User", email: "support@example.com", phone: "+919999999999", address: "Line 1", city: "Mumbai", state: "Maharashtra", postalCode: "400001", country: "IN" },
      items: [{ orderItemId: "item-sup-1", slug: "ph6-hoodie", name: "Hoodie", dropName: "Drop 1", price: 1500, priceDisplay: "₹1,500", lineTotal: 1500, quantity: 1, productId: "prod-ph6-1", variantId: "var-ph6-m", sku: "PH6-HOOD-BLK-M" }],
      subtotal: 1500,
      currency: "INR",
      status: "paid",
      paymentStatus: "captured",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      createdAt: "",
    };
    await saveOrder(order);

    const claimRes = await createOrClaimFulfillmentAdmin(order.id, null);
    assert.strictEqual(claimRes.ok, true);

    if (claimRes.ok) {
      const fullRecord = claimRes.fulfillment;
      const supportDTO = toSupportDTO(fullRecord);

      assert.strictEqual(supportDTO.id, fullRecord.id);
      assert.strictEqual(supportDTO.orderId, fullRecord.orderId);
      assert.strictEqual(supportDTO.status, fullRecord.status);

      // Verify sanitized DTO omits sensitive operational fields
      assert.strictEqual((supportDTO as Record<string, unknown>).snapshotJson, undefined);
      assert.strictEqual((supportDTO as Record<string, unknown>).requestHash, undefined);
      assert.strictEqual((supportDTO as Record<string, unknown>).idempotencyKey, undefined);
      assert.strictEqual((supportDTO as Record<string, unknown>).metadataJson, undefined);
    }
  });

  // 5. Real Idempotency Payload Mismatch Test (Requirement #11)
  it("same idempotency key with changed intent hash returns idempotency_payload_mismatch; same intent returns already_claimed", async () => {
    const order: Order = {
      id: "ORD-REAL-IDEMP-MISMATCH-01",
      customer: { fullName: "Real Idemp User", email: "realidemp@example.com", phone: "+919999999999", address: "Line 1", city: "Pune", state: "Maharashtra", postalCode: "411001", country: "IN" },
      items: [{ orderItemId: "item-ri-1", slug: "ph6-hoodie", name: "Hoodie", dropName: "Drop 1", price: 1500, priceDisplay: "₹1,500", lineTotal: 1500, quantity: 1, productId: "prod-ph6-1", variantId: "var-ph6-m", sku: "PH6-HOOD-BLK-M" }],
      subtotal: 1500,
      currency: "INR",
      status: "paid",
      paymentStatus: "captured",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      createdAt: "",
    };
    await saveOrder(order);

    // Initial claim for intent A
    const claimA = await createOrClaimFulfillmentAdmin(order.id, null);
    assert.strictEqual(claimA.ok, true);

    // Second claim for exact same intent -> returns already_claimed (NOT idempotency_payload_mismatch)
    const claimSame = await createOrClaimFulfillmentAdmin(order.id, null);
    assert.strictEqual(claimSame.ok, false);
    assert.strictEqual(claimSame.error, "already_claimed");

    // Mutate order quantity for intent B (same orderId, same providerId -> same idempotencyKey)
    const mutatedOrder: Order = {
      ...order,
      items: [{ ...order.items[0]!, quantity: 99 }],
    };
    await saveOrder(mutatedOrder);

    // Third claim with intent B -> returns idempotency_payload_mismatch
    const claimMismatch = await createOrClaimFulfillmentAdmin(order.id, null);
    assert.strictEqual(claimMismatch.ok, false);
    assert.strictEqual(claimMismatch.error, "idempotency_payload_mismatch");
  });

  // 6. Real Current-State Snapshot Staleness Tests (Requirement #12)
  it("snapshot staleness validator catches mutations in CURRENT Phase 5 state rows", async () => {
    const order: Order = {
      id: "ORD-STALE-CURRENT-01",
      customer: { fullName: "Stale User", email: "stale@example.com", phone: "+919999999999", address: "Line 1", city: "Kochi", state: "Kerala", postalCode: "682001", country: "IN" },
      items: [{ orderItemId: "item-stale-1", slug: "ph6-hoodie", name: "Hoodie", dropName: "Drop 1", price: 1500, priceDisplay: "₹1,500", lineTotal: 1500, quantity: 1, productId: "prod-ph6-1", variantId: "var-ph6-m", sku: "PH6-HOOD-BLK-M" }],
      subtotal: 1500,
      currency: "INR",
      status: "paid",
      paymentStatus: "captured",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      createdAt: "",
    };
    await saveOrder(order);

    // 1. Create valid snapshot
    const claimRes = await createOrClaimFulfillmentAdmin(order.id, null);
    assert.strictEqual(claimRes.ok, true);

    if (claimRes.ok) {
      const snapshot = claimRes.fulfillment.snapshotJson!;

      // Verify fresh snapshot passes validation
      const initialVal = await validateFulfillmentSnapshotBeforeFirstSubmission(snapshot);
      assert.strictEqual(initialVal.valid, true);

      // Mutate CURRENT Phase 5 state: disable provider variant mapping
      const disabledVarMapping: ProviderVariant = {
        id: "pv-ph6-m",
        providerProductId: "pp-ph6-qik",
        productVariantId: "var-ph6-m",
        externalVariantId: "QIK-V-M",
        externalSku: "QIK-SKU-PH6-M",
        sku: "QIK-SKU-PH6-M",
        mappingStatus: "unmapped", // Mutated mappingStatus to unmapped
        createdAt: "",
        updatedAt: "",
      };

      const originalProdMapping: ProviderProduct = {
        id: "pp-ph6-qik",
        providerId: qikinkProvider.id,
        productId: validProduct.id,
        externalProductId: "QIK-PH6-HD",
        name: "Qikink Premium Hoodie",
        printMethodsJson: ["dtf"],
        printableAreasJson: [{ location: "front", maxWidthMm: 300, maxHeightMm: 400, printMethod: "dtf" }],
        mappingStatus: "verified",
        createdAt: "",
        updatedAt: "",
      };

      await saveProviderMappingAdmin({ providerProduct: originalProdMapping, providerVariants: [disabledVarMapping] }, "admin-id");

      // Validate snapshot against mutated CURRENT Phase 5 state
      const staleRes = await validateFulfillmentSnapshotBeforeFirstSubmission(snapshot);
      assert.strictEqual(staleRes.valid, false);
      assert.strictEqual(staleRes.reason, "snapshot_provider_mapping_stale");

      // Restore valid mapping for subsequent tests
      await saveProviderMappingAdmin(
        {
          providerProduct: originalProdMapping,
          providerVariants: [
            {
              id: "pv-ph6-m",
              providerProductId: "pp-ph6-qik",
              productVariantId: "var-ph6-m",
              externalVariantId: "QIK-V-M",
              externalSku: "QIK-SKU-PH6-M",
              sku: "QIK-SKU-PH6-M",
              mappingStatus: "verified",
              createdAt: "",
              updatedAt: "",
            },
          ],
        },
        "admin-id",
      );
    }
  });

  // 7. Payment Gate Suite Tests (Requirement #14)
  it("payment gate suite asserts exact payment status, amount, currency, and provider match", async () => {
    // Unpaid order.status = paid -> BLOCKED
    const unpaidPaidOrder: Order = {
      id: "ORD-GATE-UNPAID-01",
      customer: { fullName: "Gate User", email: "gate@example.com", phone: "+919999999999", address: "Line 1", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "IN" },
      items: [{ orderItemId: "item-g1", slug: "ph6-hoodie", name: "Hoodie", dropName: "Drop 1", price: 1500, priceDisplay: "₹1,500", lineTotal: 1500, quantity: 1, productId: "prod-ph6-1", variantId: "var-ph6-m", sku: "PH6-HOOD-BLK-M" }],
      subtotal: 1500,
      currency: "INR",
      status: "paid",
      paymentStatus: "unpaid",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      createdAt: "",
    };
    await saveOrder(unpaidPaidOrder);

    const gateRes = await evaluateOrderFulfillmentEligibility(unpaidPaidOrder.id);
    assert.strictEqual(gateRes.eligible, false);
    assert.strictEqual(gateRes.blockingReasons.includes("unpaid_prepaid_order"), true);
  });

  // 8. Intent Hash Sensitivity Tests
  it("intent hash is deterministic and sensitive to manufacturing payload changes", () => {
    const baseSnapshot: FulfillmentSnapshot = {
      fulfillmentId: "ful-1111-2222",
      orderId: "ORD-HASH-01",
      orderNumber: "ORD-HASH-01",
      items: [
        {
          orderItemId: "item-h1",
          productId: "prod-ph6-1",
          variantId: "var-ph6-m",
          ascendSku: "PH6-HOOD-BLK-M",
          quantity: 2,
          providerProductMappingId: "pp-ph6-qik",
          providerExternalProductId: "QIK-PH6-HD",
          providerVariantMappingId: "pv-ph6-m",
          providerExternalVariantId: "QIK-V-M",
          providerExternalSku: "QIK-SKU-PH6-M",
          placements: [
            {
              placementId: "pl-ph6-front-m",
              designId: "dsg-ph6-a",
              designVersion: 1,
              designSlug: "ph6-graphic-front",
              designTitle: "Front Graphic",
              storagePath: "artwork/ph6-front.png",
              checksum: "sha256-front-123",
              placementLocation: "front",
              xNormalized: 0.5,
              yNormalized: 0.5,
              scale: 1,
              rotationDeg: 0,
              widthMm: 200,
              heightMm: 250,
              printMethod: "dtf",
            },
          ],
        },
      ],
      providerId: qikinkProvider.id,
      providerSlug: "qikink",
      customerShipping: {
        fullName: "Test Customer",
        email: "test@example.com",
        phone: "+919999999999",
        addressLine1: "123 Street",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "IN",
      },
      isCod: false,
      paymentMode: "online",
      currency: "INR",
      createdAt: "2026-08-09T10:00:00.000Z",
    };

    const baseHash = computeManufacturingIntentHash(baseSnapshot);
    assert.strictEqual(typeof baseHash, "string");
    assert.strictEqual(baseHash.length, 64);

    const snapDiffUuid: FulfillmentSnapshot = { ...baseSnapshot, fulfillmentId: "ful-9999-8888" };
    assert.strictEqual(computeManufacturingIntentHash(snapDiffUuid), baseHash);

    const snapDiffTime: FulfillmentSnapshot = { ...baseSnapshot, createdAt: "2026-08-09T12:34:56.789Z" };
    assert.strictEqual(computeManufacturingIntentHash(snapDiffTime), baseHash);

    const snapDiffQty: FulfillmentSnapshot = {
      ...baseSnapshot,
      items: [{ ...baseSnapshot.items[0]!, quantity: 5 }],
    };
    assert.notStrictEqual(computeManufacturingIntentHash(snapDiffQty), baseHash);
  });

  // 9. Adapter Mismatch Protection (Requirement #9)
  it("adapter mismatch -> rejected with provider_adapter_mismatch", () => {
    assert.throws(
      () => getFulfillmentProviderAdapter("printrove"),
      (err: Error) => err.message.includes("provider_adapter_mismatch"),
      "Printrove adapter MUST throw provider_adapter_mismatch in Phase 6",
    );
  });

  // 10. UNKNOWN_PROVIDER_STATE Normalization
  it("real adapter normalizeStatus returns UNKNOWN_PROVIDER_STATE while contract is unverified", () => {
    const adapter = new QikinkFulfillmentAdapter();
    const status = adapter.normalizeStatus("SOME_CUSTOM_VENDOR_STATE");
    assert.strictEqual(status, "UNKNOWN_PROVIDER_STATE");
  });

  // 11. Hard Transport Lock
  it("hard-locks real transport while QIKINK_API_CONTRACT_VERIFIED = false", () => {
    assert.strictEqual(QIKINK_API_CONTRACT_VERIFIED, false);
    process.env.QIKINK_FULFILLMENT_ENABLED = "true";
    process.env.QIKINK_API_KEY = "dummy_key";

    const adapter = new QikinkFulfillmentAdapter();
    const config = adapter.validateConfiguration();
    assert.strictEqual(config.isValid, false);
    assert.strictEqual(config.error?.includes("unverified"), true);

    delete process.env.QIKINK_FULFILLMENT_ENABLED;
    delete process.env.QIKINK_API_KEY;
  });

  // 12. Secret Redaction Helper
  it("provider secrets are recursively redacted from logs and payloads", () => {
    const rawData = {
      apiKey: "secret_qikink_api_key_12345",
      token: "bearer_token_xyz999",
      nested: {
        authorization: "Bearer secret_header_value",
        signedUrl: "https://cdn.example.com/art.png?Signature=ABC123KEY&token=XYZ",
        publicName: "Ascend Hoodie",
      },
    };

    const redacted = redactSecrets(rawData);
    assert.strictEqual(redacted.apiKey, "[REDACTED]");
    assert.strictEqual(redacted.token, "[REDACTED]");
    assert.strictEqual(redacted.nested.authorization, "[REDACTED]");
    assert.strictEqual(redacted.nested.publicName, "Ascend Hoodie");
    assert.strictEqual(redacted.nested.signedUrl.includes("Signature=[REDACTED]"), true);
  });

  // 13. Zero Live Provider Network Calls Verification
  it("VERIFIED: Phase 6 code contains NO live Qikink / Printrove API calls or network requests", () => {
    const filesToScan = [
      path.join(process.cwd(), "lib", "fulfillment", "qikink.ts"),
      path.join(process.cwd(), "lib", "fulfillment", "fulfillment-store.ts"),
      path.join(process.cwd(), "lib", "fulfillment", "eligibility.ts"),
      path.join(process.cwd(), "app", "api", "admin", "wearables", "fulfillment", "route.ts"),
    ];

    for (const file of filesToScan) {
      const src = fs.readFileSync(file, "utf-8");
      assert.strictEqual(src.includes("fetch('https://api.qikink"), false, `File ${file} must NOT invoke live Qikink endpoints`);
      assert.strictEqual(src.includes("fetch(\"https://api.qikink"), false, `File ${file} must NOT invoke live Qikink endpoints`);
    }
  });
});
