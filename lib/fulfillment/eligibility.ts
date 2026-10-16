/**
 * Phase 6 — Server-Side Fulfilment Eligibility Evaluator
 * Evaluates whether an Ascend customer order is eligible for POD manufacturing fulfillment.
 * Enforces strict captured payment evidence, COD Phase 7 gate, missing orderItemId check,
 * and strict Qikink provider mapping.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { getOrderAdmin } from "@/lib/orders/store";
import { getAllProviderMappingsAdmin, getAllPODProvidersAdmin, getAllMockupsAdmin, getAllDesignsAdmin } from "@/lib/wearables/design-store";
import { getProductAdmin } from "@/lib/wearables/store";
import { evaluateVariantReadiness } from "@/lib/wearables/readiness-engine";
import type { FulfillmentEligibilityResult } from "./types";
import { getFulfillmentByOrderIdAdmin } from "./fulfillment-store";

export async function evaluateOrderFulfillmentEligibility(
  orderId: string,
  currentFulfillmentId?: string,
): Promise<FulfillmentEligibilityResult> {
  const blockingReasons: string[] = [];

  const order = await getOrderAdmin(orderId);
  if (!order) {
    return { eligible: false, blockingReasons: ["order_not_found"] };
  }

  // 1. Explicit Phase 7 COD Fulfillment Gate Check (Requirement #3)
  const isCod = order.paymentMethod === "cod" || Boolean(order.isCod);
  if (isCod) {
    if (order.codStatus !== "COD_APPROVED") {
      blockingReasons.push("cod_approval_required");
    }
  } else {
    // 2. Strict Authoritative Prepaid Payment Gate (Requirement #7)
    if (hasSupabaseConfig()) {
      const supabase = createSupabaseServiceClient();
      if (!supabase) {
        return { eligible: false, blockingReasons: ["supabase_service_client_unconfigured"] };
      }

      // Query DB for authoritative payment status & matching captured payment row
      const { data: orderRow, error: orderErr } = await supabase
        .from("orders")
        .select("id, status, payment_status, total_paise, subtotal_paise, currency, payment_provider")
        .eq("id", orderId)
        .single();

      if (orderErr || !orderRow) {
        console.error("[Eligibility] DB error fetching order:", orderErr);
        blockingReasons.push("db_error_verifying_payment");
      } else if (orderRow.payment_status !== "captured") {
        // Requirement #7: Strictly require orders.payment_status = 'captured' (status = paid alone is insufficient)
        blockingReasons.push("unpaid_prepaid_order");
      } else {
        const orderTotalPaise = Number(orderRow.total_paise || orderRow.subtotal_paise || 0);

        const { data: paymentRow, error: paymentErr } = await supabase
          .from("payments")
          .select("id, status, amount_paise, currency, provider")
          .eq("order_id", orderId)
          .eq("status", "captured")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (paymentErr) {
          console.error("[Eligibility] DB error fetching payment row:", paymentErr);
          blockingReasons.push("db_error_verifying_payment");
        } else if (!paymentRow) {
          blockingReasons.push("unpaid_prepaid_order");
        } else if (Number(paymentRow.amount_paise) !== orderTotalPaise || paymentRow.currency !== (orderRow.currency || "INR")) {
          blockingReasons.push("payment_amount_currency_mismatch");
        } else if (orderRow.payment_provider && paymentRow.provider !== orderRow.payment_provider) {
          blockingReasons.push("payment_provider_mismatch");
        }
      }
    } else {
      // Memory fallback for dev/testing when Supabase is not configured
      const isCaptured = order.paymentStatus === "captured";
      if (!isCaptured) {
        blockingReasons.push("unpaid_prepaid_order");
      }
    }
  }

  // 3. Shipping Address Completeness Check
  const addr = order.shippingAddress || order.customer;
  const line1 = addr?.addressLine1 || addr?.address;
  if (!addr || !addr.fullName?.trim() || !line1?.trim() || !addr.city?.trim() || !addr.postalCode?.trim()) {
    blockingReasons.push("incomplete_shipping_address");
  }

  // 4. Duplicate Active Fulfillment Conflict Check
  const existingFulfillment = await getFulfillmentByOrderIdAdmin(orderId);
  if (
    existingFulfillment &&
    existingFulfillment.id !== currentFulfillmentId &&
    !["FAILED", "CANCELLED"].includes(existingFulfillment.status)
  ) {
    blockingReasons.push("existing_active_fulfillment_conflict");
  }

  // 5. Order Items & Provider Mappings
  const items = order.items || [];
  if (items.length === 0) {
    blockingReasons.push("empty_order_items");
  }

  // Requirement #4: Every order item MUST have a real orderItemId when Supabase is configured
  for (const item of items) {
    if (!item.orderItemId) {
      blockingReasons.push("missing_order_item_id");
    }
  }

  const providers = await getAllPODProvidersAdmin();
  const qikinkProvider = providers.find((p) => p.slug.toLowerCase() === "qikink" && p.isActive);

  if (!qikinkProvider) {
    blockingReasons.push("qikink_provider_not_configured");
  }

  const selectedProvider = qikinkProvider;
  let selectedProviderProduct = undefined;
  let selectedProviderVariant = undefined;

  for (const item of items) {
    if (!item.productId || !item.variantId) {
      blockingReasons.push("missing_item_variant_identity");
      continue;
    }

    const product = await getProductAdmin(item.productId);
    if (!product || product.status !== "active") {
      blockingReasons.push("draft_product");
      continue;
    }

    const variant = (product.variants || []).find((v) => v.id === item.variantId);
    if (!variant || !variant.isActive) {
      blockingReasons.push("inactive_variant");
      continue;
    }
    if (variant.availabilityStatus !== "available") {
      blockingReasons.push("unavailable_variant");
    }

    const mappings = await getAllProviderMappingsAdmin();
    const designs = await getAllDesignsAdmin();
    const mockups = await getAllMockupsAdmin();

    const designsMap = new Map(designs.map((d) => [d.id, d]));
    const placementsList = designs.flatMap((d) => d.placements || []);

    // Explicitly require Qikink mapping (Req #8 & #9)
    const pProd = mappings.providerProducts.find(
      (pp) => pp.productId === product.id && pp.mappingStatus === "verified" && pp.providerId === qikinkProvider?.id,
    );

    if (!pProd) {
      const printroveProd = mappings.providerProducts.find(
        (pp) => pp.productId === product.id && pp.mappingStatus === "verified",
      );
      if (printroveProd) {
        blockingReasons.push("qikink_mapping_missing_for_order_item");
        blockingReasons.push("no_common_supported_provider_for_order");
      } else {
        blockingReasons.push("unverified_provider_product_mapping");
      }
      continue;
    }

    const pVar = mappings.providerVariants.find(
      (pv) => pv.productVariantId === variant.id && pv.providerProductId === pProd.id && pv.mappingStatus === "verified",
    );

    if (!pVar) {
      blockingReasons.push("unverified_provider_variant_mapping");
      continue;
    }

    selectedProviderProduct = pProd;
    selectedProviderVariant = pVar;

    const vPlacements = placementsList.filter((p) => p.productVariantId === variant.id && p.isActive);

    const readiness = evaluateVariantReadiness({
      product,
      variant,
      placements: vPlacements,
      designsMap,
      providers: qikinkProvider ? [qikinkProvider] : [],
      providerProduct: pProd,
      providerVariant: pVar,
      providerMappings: qikinkProvider ? [{ provider: qikinkProvider, productVariantId: variant.id, providerProduct: pProd, providerVariant: pVar }] : [],
      mockups: mockups.filter((m) => m.productId === product.id),
    });

    if (!readiness.readyForFulfillment) {
      blockingReasons.push(...readiness.blockingReasons);
    }
  }

  const uniqueReasons = Array.from(new Set(blockingReasons));
  const eligible = uniqueReasons.length === 0;

  return {
    eligible,
    blockingReasons: uniqueReasons,
    order,
    provider: selectedProvider,
    providerProduct: selectedProviderProduct,
    providerVariant: selectedProviderVariant,
  };
}
