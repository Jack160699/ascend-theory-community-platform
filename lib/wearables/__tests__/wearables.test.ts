import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  getPublicProductBySlug,
  getAuthoritativeVariantForCheckout,
  saveProductAdmin,
  getAllProductsAdmin,
} from "../store";
import { buildOrderFromInputAsync } from "../../orders/build-order";
import { getDropBySlugAsync } from "../../data/drops";
import { getCartProductFromLine } from "../../cart/catalog";
import {
  applyAddProduct,
  applySetQuantity,
  applyRemoveLine,
  validateAddProductInput,
  lineIdentityKey,
  isLineInvalid,
} from "../../cart/cart-helpers";
import type { CartLine } from "../../cart/types";

// ============================================================
// HELPERS — variant matrix builder for selector tests
// ============================================================
function makeVariant(overrides: {
  id: string;
  sku: string;
  size: string;
  color: string;
  colorDisplay?: string;
  pricePaise?: number;
}): {
  id: string;
  sku: string;
  size: string;
  color: string;
  colorDisplay?: string;
  pricePaise: number;
  isActive: boolean;
  availabilityStatus: "available";
} {
  return {
    pricePaise: 100000,
    isActive: true,
    availabilityStatus: "available",
    colorDisplay: overrides.colorDisplay ?? overrides.color,
    ...overrides,
  };
}

/** Simulate selectColor logic from DropCartButton */
function simulateSelectColor(
  variants: ReturnType<typeof makeVariant>[],
  currentSelectedId: string,
  newColor: string,
): string {
  const currentVariant = variants.find((v) => v.id === currentSelectedId);
  const currentSize = currentVariant?.size ?? "";

  // Try same-color + same-size first; else first variant with new color
  const sameColorSameSize = variants.find(
    (v) => v.color === newColor && v.size === currentSize,
  );
  const firstWithNewColor = variants.find((v) => v.color === newColor);
  const target = sameColorSameSize ?? firstWithNewColor;
  return target?.id ?? currentSelectedId;
}

/** Simulate selectSize logic from DropCartButton */
function simulateSelectSize(
  variants: ReturnType<typeof makeVariant>[],
  currentSelectedId: string,
  newSize: string,
): string {
  const currentVariant = variants.find((v) => v.id === currentSelectedId);
  const currentColor = currentVariant?.color ?? "";

  const sameColorNewSize = variants.find(
    (v) => v.size === newSize && v.color === currentColor,
  );
  const anyWithNewSize = variants.find((v) => v.size === newSize);
  const target = sameColorNewSize ?? anyWithNewSize;
  return target?.id ?? currentSelectedId;
}

describe("Phase 4 — Wearables Security & Cart Integrity Tests", () => {
  // ============================================================
  // SECTION 1: Migration 00004 SQL structure assertions
  // ============================================================
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260809000004_wearables_catalogue_management.sql"),
    "utf-8",
  );

  it("migration 00004 enforces column-level privilege lockdown revoking provider_cost_paise from anon/authenticated", () => {
    assert.strictEqual(sql.includes("REVOKE ALL ON public.product_variants FROM PUBLIC, anon, authenticated;"), true);
    const selectGrantBlock = sql.match(/GRANT SELECT \([\s\S]*?\) ON public\.product_variants TO anon, authenticated;/);
    assert.notStrictEqual(selectGrantBlock, null);
    if (selectGrantBlock) {
      assert.strictEqual(selectGrantBlock[0].includes("provider_cost_paise"), false);
    }
  });

  it("migration 00004 has PASS 1 validate-everything before PASS 2 mutate", () => {
    assert.strictEqual(sql.includes("PASS 1: VALIDATE EVERYTHING, WRITE NOTHING"), true);
    assert.strictEqual(sql.includes("PASS 2: MUTATE"), true);
    // Ensure variant validation loop appears BEFORE any INSERT/UPDATE in the function
    const pass1Idx = sql.indexOf("PASS 1: VALIDATE EVERYTHING");
    const pass2Idx = sql.indexOf("PASS 2: MUTATE");
    const firstInsertAfterBegin = sql.indexOf("INSERT INTO public.products");
    assert.ok(pass1Idx < pass2Idx, "PASS 1 must appear before PASS 2");
    assert.ok(pass2Idx < firstInsertAfterBegin, "Mutations must come after PASS 2 marker");
  });

  it("migration 00004 uses RAISE EXCEPTION semantics (EXCEPTION WHEN OTHERS THEN) for post-write rollback", () => {
    assert.strictEqual(sql.includes("EXCEPTION WHEN OTHERS THEN"), true);
    assert.strictEqual(sql.includes("RETURN jsonb_build_object('ok', false, 'error', SQLERRM)"), true);
  });

  it("migration 00004 save_product_with_variants: REVOKE from PUBLIC/anon/authenticated, GRANT to service_role", () => {
    assert.strictEqual(
      sql.includes("REVOKE ALL ON FUNCTION public.save_product_with_variants(JSONB, JSONB, UUID) FROM PUBLIC, anon, authenticated;"),
      true,
    );
    assert.strictEqual(
      sql.includes("GRANT EXECUTE ON FUNCTION public.save_product_with_variants(JSONB, JSONB, UUID) TO service_role;"),
      true,
    );
  });

  it("migration 00004 save_collection_with_audit: REVOKE from PUBLIC/anon/authenticated, GRANT to service_role", () => {
    assert.strictEqual(
      sql.includes("REVOKE ALL ON FUNCTION public.save_collection_with_audit(JSONB, UUID) FROM PUBLIC, anon, authenticated;"),
      true,
    );
    assert.strictEqual(
      sql.includes("GRANT EXECUTE ON FUNCTION public.save_collection_with_audit(JSONB, UUID) TO service_role;"),
      true,
    );
  });

  it("migration 00004 validates availability enum before write", () => {
    assert.strictEqual(sql.includes("NOT IN ('available', 'unavailable', 'sample_only', 'returned_inventory_only')"), true);
  });

  it("migration 00004 validates duplicate SKU within payload before write", () => {
    assert.strictEqual(sql.includes("v_payload_skus"), true);
    assert.strictEqual(sql.includes("Duplicate variant SKU"), true);
  });

  it("migration 00004 validates collection ID existence before write", () => {
    assert.strictEqual(sql.includes("Collection ID"), true);
    assert.strictEqual(sql.includes("does not exist"), true);
  });

  it("migration 00004 contains cross-product variant ID protection", () => {
    assert.strictEqual(sql.includes("variant_product_mismatch"), true);
    assert.strictEqual(sql.includes("product_id != v_product_id"), true);
  });

  it("migration 00004 rejects empty size and color", () => {
    assert.strictEqual(sql.includes("has empty size"), true);
    assert.strictEqual(sql.includes("has empty color"), true);
  });

  it("migration 00004 prevents product_id ownership change in ON CONFLICT UPDATE", () => {
    assert.strictEqual(sql.includes("WHERE product_variants.product_id = v_product_id"), true);
  });

  // ============================================================
  // SECTION 2: Memory-path TRUE ATOMICITY
  // ============================================================
  it("bad second variant rolls back: product title stays old, variant A stays old, no partial write", async () => {
    // Create product with two variants
    const r1 = await saveProductAdmin(
      {
        title: "Atomicity Base Product",
        slug: "atomicity-base-product",
        description: "Test",
        status: "draft",
        variants: [
          { id: "var-atom-a", sku: "ATOM-A-M", size: "M", color: "black", pricePaise: 100000, providerCostPaise: 40000, isActive: true, availabilityStatus: "available" },
          { id: "var-atom-b", sku: "ATOM-B-L", size: "L", color: "black", pricePaise: 100000, providerCostPaise: 40000, isActive: true, availabilityStatus: "available" },
        ],
      },
      "admin-id",
    );
    assert.strictEqual(r1.ok, true, "Initial save must succeed");

    // Now submit an update: title changed, variant A changed, variant B has an empty color
    const r2 = await saveProductAdmin(
      {
        title: "CHANGED TITLE — MUST NOT PERSIST",
        slug: "atomicity-base-product",
        id: "prod-atomicity-base-product", // same product
        description: "Changed",
        status: "draft",
        variants: [
          { id: "var-atom-a", sku: "ATOM-A-M-CHANGED", size: "XL", color: "white", pricePaise: 200000, providerCostPaise: 80000, isActive: true, availabilityStatus: "available" },
          { id: "var-atom-b", sku: "ATOM-B-L", size: "L", color: "", pricePaise: 100000, providerCostPaise: 40000, isActive: true, availabilityStatus: "available" }, // empty color — invalid
        ],
      },
      "admin-id",
    );

    // Must fail
    assert.strictEqual(r2.ok, false, "Save with invalid second variant must fail");
    if (!r2.ok) {
      assert.ok(r2.error.toLowerCase().includes("color"), "Error must mention color");
    }

    // Product title must remain old
    const allProds = await getAllProductsAdmin();
    const prod = allProds.find((p) => p.slug === "atomicity-base-product");
    assert.notStrictEqual(prod, undefined, "Product must still exist");
    assert.strictEqual(prod!.title, "Atomicity Base Product", "Title must NOT have changed");

    // Variant A must remain old (not mutated)
    const varA = (prod!.variants || []).find((v) => v.id === "var-atom-a");
    assert.notStrictEqual(varA, undefined, "Variant A must still exist");
    if (varA) {
      assert.strictEqual(varA.sku, "ATOM-A-M", "Variant A SKU must NOT have changed");
      assert.strictEqual(varA.size, "M", "Variant A size must NOT have changed");
      assert.strictEqual(varA.color, "black", "Variant A color must NOT have changed");
    }
  });

  it("new product creation with bad second variant: product does NOT exist afterward", async () => {
    const r = await saveProductAdmin(
      {
        title: "New Bad Variant Product",
        slug: "new-bad-variant-product",
        description: "Test",
        status: "draft",
        variants: [
          { sku: "NBV-GOOD", size: "M", color: "black", pricePaise: 100000, providerCostPaise: 40000, isActive: true, availabilityStatus: "available" },
          { sku: "", size: "L", color: "black", pricePaise: 100000, providerCostPaise: 40000, isActive: true, availabilityStatus: "available" }, // empty SKU
        ],
      },
      "admin-id",
    );

    assert.strictEqual(r.ok, false, "Must fail due to empty SKU");

    // Product must not exist
    const allProds = await getAllProductsAdmin();
    const prod = allProds.find((p) => p.slug === "new-bad-variant-product");
    assert.strictEqual(prod, undefined, "Product must NOT have been created");
  });

  it("cross-product variant ID after valid first variant: no earlier mutation persists", async () => {
    // Create product alpha
    await saveProductAdmin(
      {
        title: "Alpha Product Cross",
        slug: "alpha-product-cross",
        description: "Test",
        status: "draft",
        variants: [
          { id: "var-alpha-cross-m", sku: "ALPHA-CROSS-M", size: "M", color: "black", pricePaise: 100000, providerCostPaise: 40000, isActive: true, availabilityStatus: "available" },
        ],
      },
      "admin-id",
    );

    // Try to save Beta Product where first variant is valid but second uses Alpha's ID
    const r = await saveProductAdmin(
      {
        title: "Beta Cross Product",
        slug: "beta-cross-product",
        description: "Test",
        status: "draft",
        variants: [
          { sku: "BETA-CROSS-L", size: "L", color: "white", pricePaise: 100000, providerCostPaise: 40000, isActive: true, availabilityStatus: "available" }, // valid
          { id: "var-alpha-cross-m", sku: "BETA-CROSS-STEAL", size: "S", color: "red", pricePaise: 100000, providerCostPaise: 40000, isActive: true, availabilityStatus: "available" }, // cross-product ID
        ],
      },
      "admin-id",
    );

    assert.strictEqual(r.ok, false, "Must fail — cross-product variant ID");
    assert.ok(r.ok === false && r.error.includes("variant_product_mismatch"), "Error must say variant_product_mismatch");

    // Beta product must not exist
    const allProds = await getAllProductsAdmin();
    const beta = allProds.find((p) => p.slug === "beta-cross-product");
    assert.strictEqual(beta, undefined, "Beta product must NOT have been created");

    // Alpha variant must still be intact
    const alpha = allProds.find((p) => p.slug === "alpha-product-cross");
    assert.notStrictEqual(alpha, undefined, "Alpha product must still exist");
    const alphaVar = (alpha!.variants || []).find((v) => v.id === "var-alpha-cross-m");
    assert.notStrictEqual(alphaVar, undefined, "Alpha variant must be unchanged");
    if (alphaVar) {
      assert.strictEqual(alphaVar.sku, "ALPHA-CROSS-M");
    }
  });

  // ============================================================
  // SECTION 3: Fail-closed when Supabase is configured
  // ============================================================
  it("store.ts has fail-closed pattern: hasSupabaseConfig() gates memory fallback", () => {
    // Verify source code structure — memory fallback is only reached when hasSupabaseConfig() === false
    const storeSrc = readFileSync(
      resolve(process.cwd(), "lib/wearables/store.ts"),
      "utf-8",
    );
    assert.strictEqual(
      storeSrc.includes("if (hasSupabaseConfig())"),
      true,
      "saveProductAdmin must check hasSupabaseConfig() before DB path",
    );
    assert.strictEqual(
      storeSrc.includes("Server configuration error: Supabase service client unavailable"),
      true,
      "Must have fail-closed error when client is null but config present",
    );
    // Memory fallback must be after the Supabase block, not before
    const supabaseBlockIdx = storeSrc.indexOf("if (hasSupabaseConfig())");
    const memoryFallbackIdx = storeSrc.indexOf("LOCAL MEMORY FALLBACK");
    assert.ok(supabaseBlockIdx < memoryFallbackIdx, "Memory fallback must come AFTER Supabase block");
  });

  // ============================================================
  // SECTION 4: Collection audit integrity
  // ============================================================
  it("saveCollectionAdmin uses atomic save_collection_with_audit RPC source structure", () => {
    const storeSrc = readFileSync(
      resolve(process.cwd(), "lib/wearables/store.ts"),
      "utf-8",
    );
    assert.strictEqual(
      storeSrc.includes("save_collection_with_audit"),
      true,
      "saveCollectionAdmin must call the atomic save_collection_with_audit RPC",
    );
    // Must not silently ignore audit error (old plain .insert that was awaited but not checked)
    assert.strictEqual(
      storeSrc.includes("Collection save RPC returned error"),
      true,
      "Must check RPC result and fail if audit fails",
    );
  });

  // ============================================================
  // SECTION 5: Cart-helpers — lineIdentityKey
  // ============================================================
  it("lineIdentityKey uses variantId as primary key", () => {
    const line: CartLine = { slug: "test-product", variantId: "var-test-m", sku: "TEST-M", size: "M", color: "black", quantity: 1 };
    assert.strictEqual(lineIdentityKey(line), "var-test-m");
  });

  it("lineIdentityKey falls back to sku when variantId absent", () => {
    const line: CartLine = { slug: "legacy-product", sku: "LEGACY-M", quantity: 1 };
    assert.strictEqual(lineIdentityKey(line), "LEGACY-M");
  });

  it("lineIdentityKey marks slug-only lines as invalid", () => {
    const line: CartLine = { slug: "no-identity-product", quantity: 1 };
    const key = lineIdentityKey(line);
    assert.ok(key.startsWith("__invalid__"), "Slug-only lines must produce an __invalid__ key");
    assert.strictEqual(isLineInvalid(line), true);
  });

  it("validateAddProductInput rejects missing variantId", () => {
    assert.strictEqual(validateAddProductInput({ slug: "s", sku: "SKU", size: "M", color: "black" }), false);
  });
  it("validateAddProductInput rejects missing sku", () => {
    assert.strictEqual(validateAddProductInput({ slug: "s", variantId: "v", size: "M", color: "black" }), false);
  });
  it("validateAddProductInput rejects missing size", () => {
    assert.strictEqual(validateAddProductInput({ slug: "s", variantId: "v", sku: "SKU", color: "black" }), false);
  });
  it("validateAddProductInput rejects missing color", () => {
    assert.strictEqual(validateAddProductInput({ slug: "s", variantId: "v", sku: "SKU", size: "M" }), false);
  });
  it("validateAddProductInput accepts complete input", () => {
    assert.strictEqual(
      validateAddProductInput({ slug: "s", variantId: "v", sku: "SKU", size: "M", color: "black" }),
      true,
    );
  });

  // ============================================================
  // SECTION 6: Cart behaviour tests
  // ============================================================
  it("add M once → qty 1", () => {
    const lineM: CartLine = { slug: "jacket", variantId: "var-m", sku: "JKT-M", size: "M", color: "black", quantity: 1 };
    const cart = applyAddProduct([], lineM);
    assert.strictEqual(cart.length, 1);
    assert.strictEqual(cart[0].quantity, 1);
    assert.strictEqual(cart[0].variantId, "var-m");
  });

  it("add M again → same line qty 2", () => {
    const lineM: CartLine = { slug: "jacket", variantId: "var-m", sku: "JKT-M", size: "M", color: "black", quantity: 1 };
    let cart = applyAddProduct([], lineM);
    cart = applyAddProduct(cart, lineM, 10);
    assert.strictEqual(cart.length, 1, "Must remain one line");
    assert.strictEqual(cart[0].quantity, 2);
  });

  it("add M then L → two separate lines", () => {
    const lineM: CartLine = { slug: "jacket", variantId: "var-m", sku: "JKT-M", size: "M", color: "black", quantity: 1 };
    const lineL: CartLine = { slug: "jacket", variantId: "var-l", sku: "JKT-L", size: "L", color: "black", quantity: 1 };
    let cart = applyAddProduct([], lineM);
    cart = applyAddProduct(cart, lineL);
    assert.strictEqual(cart.length, 2, "M and L must be two separate lines");
    assert.strictEqual(cart.find((l) => l.variantId === "var-m")?.quantity, 1);
    assert.strictEqual(cart.find((l) => l.variantId === "var-l")?.quantity, 1);
  });

  it("increase M → only M qty changes; L stays same", () => {
    const lineM: CartLine = { slug: "jacket", variantId: "var-m", sku: "JKT-M", size: "M", color: "black", quantity: 1 };
    const lineL: CartLine = { slug: "jacket", variantId: "var-l", sku: "JKT-L", size: "L", color: "black", quantity: 1 };
    let cart = applyAddProduct([], lineM);
    cart = applyAddProduct(cart, lineL);
    cart = applySetQuantity(cart, "var-m", 3, 10);
    assert.strictEqual(cart.find((l) => l.variantId === "var-m")?.quantity, 3);
    assert.strictEqual(cart.find((l) => l.variantId === "var-l")?.quantity, 1, "L must be unchanged");
  });

  it("remove M → L remains", () => {
    const lineM: CartLine = { slug: "jacket", variantId: "var-m", sku: "JKT-M", size: "M", color: "black", quantity: 1 };
    const lineL: CartLine = { slug: "jacket", variantId: "var-l", sku: "JKT-L", size: "L", color: "black", quantity: 1 };
    let cart = applyAddProduct([], lineM);
    cart = applyAddProduct(cart, lineL);
    cart = applyRemoveLine(cart, "var-m");
    assert.strictEqual(cart.length, 1, "Only one line must remain");
    assert.strictEqual(cart[0].variantId, "var-l");
  });

  it("same size Black and White → two separate lines", () => {
    const black: CartLine = { slug: "jacket", variantId: "var-m-black", sku: "JKT-M-BLK", size: "M", color: "black", quantity: 1 };
    const white: CartLine = { slug: "jacket", variantId: "var-m-white", sku: "JKT-M-WHT", size: "M", color: "white", quantity: 1 };
    let cart = applyAddProduct([], black);
    cart = applyAddProduct(cart, white);
    assert.strictEqual(cart.length, 2, "Black M and White M must be separate lines");
  });

  it("addProduct without variantId is rejected", () => {
    // Simulate the runtime guard from cart context
    const input = { slug: "jacket", sku: "JKT-M", size: "M", color: "black" };
    assert.strictEqual(validateAddProductInput(input), false, "Must be rejected — no variantId");
  });

  it("quantity is capped at maxQuantity", () => {
    const line: CartLine = { slug: "jacket", variantId: "var-m", sku: "JKT-M", size: "M", color: "black", quantity: 1 };
    let cart = applyAddProduct([], line, 5);
    cart = applySetQuantity(cart, "var-m", 999, 5);
    assert.strictEqual(cart[0].quantity, 5, "Quantity must be capped at maxQuantity");
  });

  it("setQuantity < 1 removes the line", () => {
    const line: CartLine = { slug: "jacket", variantId: "var-m", sku: "JKT-M", size: "M", color: "black", quantity: 2 };
    let cart = applyAddProduct([], line);
    cart = applySetQuantity(cart, "var-m", 0);
    assert.strictEqual(cart.length, 0, "Line with qty 0 must be removed");
  });

  // ============================================================
  // SECTION 7: Selector reachability tests
  // ============================================================
  it("Black/M + White/L matrix: starting Black/M → select White → becomes White/L", () => {
    const variants = [
      makeVariant({ id: "v-black-m", sku: "BLK-M", size: "M", color: "black" }),
      makeVariant({ id: "v-white-l", sku: "WHT-L", size: "L", color: "white" }),
    ];

    let selectedId = variants[0].id; // start at Black/M
    assert.strictEqual(variants.find((v) => v.id === selectedId)?.color, "black");
    assert.strictEqual(variants.find((v) => v.id === selectedId)?.size, "M");

    // Select White
    selectedId = simulateSelectColor(variants, selectedId, "white");
    const selected = variants.find((v) => v.id === selectedId);
    assert.strictEqual(selected?.color, "white", "After selecting White, color must be white");
    assert.strictEqual(selected?.size, "L", "After selecting White, size must auto-snap to L");
    assert.strictEqual(selectedId, "v-white-l");
  });

  it("Black/M + White/L matrix: starting White/L → select Black → becomes Black/M", () => {
    const variants = [
      makeVariant({ id: "v-black-m", sku: "BLK-M", size: "M", color: "black" }),
      makeVariant({ id: "v-white-l", sku: "WHT-L", size: "L", color: "white" }),
    ];

    let selectedId = variants[1].id; // start at White/L
    selectedId = simulateSelectColor(variants, selectedId, "black");
    const selected = variants.find((v) => v.id === selectedId);
    assert.strictEqual(selected?.color, "black");
    assert.strictEqual(selected?.size, "M");
    assert.strictEqual(selectedId, "v-black-m");
  });

  it("Black/M + White/L: no valid variant is unreachable from any starting point", () => {
    const variants = [
      makeVariant({ id: "v-black-m", sku: "BLK-M", size: "M", color: "black" }),
      makeVariant({ id: "v-white-l", sku: "WHT-L", size: "L", color: "white" }),
    ];
    const allIds = new Set(variants.map((v) => v.id));

    // From Black/M, reach White/L via color select
    let start = "v-black-m";
    const reachable = new Set<string>([start]);
    for (const c of ["white", "black"]) {
      reachable.add(simulateSelectColor(variants, start, c));
    }
    for (const s of ["M", "L"]) {
      reachable.add(simulateSelectSize(variants, start, s));
    }
    // From White/L
    start = "v-white-l";
    reachable.add(start);
    for (const c of ["white", "black"]) {
      reachable.add(simulateSelectColor(variants, start, c));
    }
    for (const s of ["M", "L"]) {
      reachable.add(simulateSelectSize(variants, start, s));
    }

    for (const id of allIds) {
      assert.ok(reachable.has(id), `Variant ${id} must be reachable`);
    }
  });

  it("3-variant matrix: Black/M + Black/L + White/L — all variants reachable", () => {
    const variants = [
      makeVariant({ id: "v-blk-m", sku: "BLK-M", size: "M", color: "black" }),
      makeVariant({ id: "v-blk-l", sku: "BLK-L", size: "L", color: "black" }),
      makeVariant({ id: "v-wht-l", sku: "WHT-L", size: "L", color: "white" }),
    ];

    const allIds = new Set(variants.map((v) => v.id));
    const reachable = new Set<string>();

    for (const startId of allIds) {
      reachable.add(startId);
      for (const c of ["black", "white"]) {
        reachable.add(simulateSelectColor(variants, startId, c));
      }
      for (const s of ["M", "L"]) {
        reachable.add(simulateSelectSize(variants, startId, s));
      }
    }

    for (const id of allIds) {
      assert.ok(reachable.has(id), `Variant ${id} must be reachable in 3-variant matrix`);
    }
  });

  it("selectColor preserves current size when available for new color", () => {
    const variants = [
      makeVariant({ id: "v-blk-m", sku: "BLK-M", size: "M", color: "black" }),
      makeVariant({ id: "v-wht-m", sku: "WHT-M", size: "M", color: "white" }),
      makeVariant({ id: "v-wht-l", sku: "WHT-L", size: "L", color: "white" }),
    ];

    // Start at Black/M, select White → should snap to White/M (same size preserved)
    const newId = simulateSelectColor(variants, "v-blk-m", "white");
    assert.strictEqual(newId, "v-wht-m", "Should prefer White/M (same size) over White/L");
  });

  it("selectSize uses first available when new size not in current color", () => {
    const variants = [
      makeVariant({ id: "v-blk-m", sku: "BLK-M", size: "M", color: "black" }),
      makeVariant({ id: "v-wht-l", sku: "WHT-L", size: "L", color: "white" }),
    ];

    // Start at Black/M, select size L → Black has no L, fallback to White/L
    const newId = simulateSelectSize(variants, "v-blk-m", "L");
    assert.strictEqual(newId, "v-wht-l", "Selecting L from Black/M must snap to White/L");
  });

  // ============================================================
  // SECTION 8: Existing Phase 4 regression tests preserved
  // ============================================================
  it("CartLine with display snapshot resolves product display without static CATALOG lookup", () => {
    const line: CartLine = {
      slug: "db-only-hoodie",
      variantId: "var-db-hoodie-m",
      sku: "DB-HOODIE-M",
      size: "M",
      color: "charcoal",
      quantity: 1,
      title: "DB Only Hoodie",
      image: "https://cdn.example.com/db-hoodie.jpg",
      priceDisplay: "₹3,500",
      currency: "INR",
      pricePaise: 350000,
    };
    const resolved = getCartProductFromLine(line);
    assert.notStrictEqual(resolved, undefined);
    assert.strictEqual(resolved?.name, "DB Only Hoodie");
    assert.strictEqual(resolved?.image, "https://cdn.example.com/db-hoodie.jpg");
    assert.strictEqual(resolved?.price, 3500);
  });

  it("public cannot read draft products", async () => {
    await saveProductAdmin(
      { title: "Draft Section 8", slug: "draft-sect8", description: "T", status: "draft" },
      "admin-id",
    );
    const pub = await getPublicProductBySlug("draft-sect8");
    assert.strictEqual(pub, null);
    const drop = await getDropBySlugAsync("draft-sect8");
    assert.strictEqual(drop, undefined);
  });

  it("public sees only available variants; sample_only/unavailable/returned hidden", async () => {
    await saveProductAdmin(
      {
        title: "Multi Status S8",
        slug: "multi-status-s8",
        description: "T",
        status: "active",
        primaryImageUrl: "https://example.com/img.jpg",
        variants: [
          { sku: "MS8-AVAIL-M", size: "M", color: "black", pricePaise: 300000, providerCostPaise: 100000, isActive: true, availabilityStatus: "available" },
          { sku: "MS8-SAMPLE-L", size: "L", color: "black", pricePaise: 300000, providerCostPaise: 100000, isActive: true, availabilityStatus: "sample_only" },
        ],
      },
      "admin-id",
    );
    const pub = await getPublicProductBySlug("multi-status-s8");
    assert.notStrictEqual(pub, null);
    if (pub) {
      assert.strictEqual(pub.variants.length, 1);
      assert.strictEqual(pub.variants[0].sku, "MS8-AVAIL-M");
      assert.strictEqual("providerCostPaise" in pub.variants[0], false);
    }
  });

  it("rejects checkout build if both SKU and variantId are omitted", async () => {
    const res = await buildOrderFromInputAsync({
      items: [{ slug: "multi-status-s8", quantity: 1 }],
      paymentMethod: "online",
      customer: {
        fullName: "No SKU Tester",
        email: "test@example.com",
        phone: "+919999999999",
        address: "123 St",
        city: "Mumbai",
        postalCode: "400001",
        country: "IN",
      },
    });
    assert.strictEqual(res.ok, false);
  });

  it("server resolves authoritative price; client-supplied price is ignored", async () => {
    await saveProductAdmin(
      {
        title: "Price Tamper S8",
        slug: "price-tamper-s8",
        description: "D",
        status: "active",
        primaryImageUrl: "https://example.com/img.jpg",
        variants: [
          { id: "var-pts8-m", sku: "PTS8-M", size: "M", color: "black", pricePaise: 500000, providerCostPaise: 200000, isActive: true, availabilityStatus: "available" },
        ],
      },
      "admin-id",
    );
    const res = await buildOrderFromInputAsync({
      items: [{ slug: "price-tamper-s8", sku: "PTS8-M", quantity: 1, price: 1 }],
      paymentMethod: "online",
      customer: {
        fullName: "Tamper Tester",
        email: "tamper@example.com",
        phone: "+919999999999",
        address: "123 St",
        city: "Mumbai",
        postalCode: "400001",
        country: "IN",
      },
    });
    assert.strictEqual(res.ok, true);
    if (res.ok) {
      assert.strictEqual(res.order.items[0].price, 5000); // 500000 paise / 100, not client price 1
    }
  });

  it("archived product is hidden from public catalogue", async () => {
    await saveProductAdmin(
      { title: "Archived S8", slug: "archived-s8", description: "T", status: "archived" },
      "admin-id",
    );
    const pub = await getPublicProductBySlug("archived-s8");
    assert.strictEqual(pub, null);
  });

  it("checkout validates unknown SKU", async () => {
    const res = await getAuthoritativeVariantForCheckout({ sku: "COMPLETELY-UNKNOWN-SKU-S8" });
    assert.strictEqual(res.ok, false);
  });

  // ============================================================
  // SECTION 9: Migration 00005 RLS Scope & DropCartButton clean state
  // ============================================================
  it("migration 00005 exists and scopes all admin RLS policies explicitly TO authenticated", () => {
    const sql00005 = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260809000005_fix_wearables_rls_policy_scope.sql"),
      "utf-8",
    );

    // Products admin policies
    assert.strictEqual(sql00005.includes('CREATE POLICY "Admin read products" ON public.products'), true);
    assert.strictEqual(sql00005.includes('CREATE POLICY "Admin write products" ON public.products'), true);
    const prodReadMatch = sql00005.match(/CREATE POLICY "Admin read products"[\s\S]*?TO authenticated[\s\S]*?USING/);
    assert.notStrictEqual(prodReadMatch, null, 'Admin read products policy must contain "TO authenticated"');
    const prodWriteMatch = sql00005.match(/CREATE POLICY "Admin write products"[\s\S]*?TO authenticated[\s\S]*?USING/);
    assert.notStrictEqual(prodWriteMatch, null, 'Admin write products policy must contain "TO authenticated"');

    // Product variants admin policies
    assert.strictEqual(sql00005.includes('CREATE POLICY "Admin read product variants" ON public.product_variants'), true);
    assert.strictEqual(sql00005.includes('CREATE POLICY "Admin write product variants" ON public.product_variants'), true);
    const varReadMatch = sql00005.match(/CREATE POLICY "Admin read product variants"[\s\S]*?TO authenticated[\s\S]*?USING/);
    assert.notStrictEqual(varReadMatch, null, 'Admin read product variants policy must contain "TO authenticated"');
    const varWriteMatch = sql00005.match(/CREATE POLICY "Admin write product variants"[\s\S]*?TO authenticated[\s\S]*?USING/);
    assert.notStrictEqual(varWriteMatch, null, 'Admin write product variants policy must contain "TO authenticated"');

    // Collections admin policies
    assert.strictEqual(sql00005.includes('CREATE POLICY "Admin read collections" ON public.collections'), true);
    assert.strictEqual(sql00005.includes('CREATE POLICY "Admin write collections" ON public.collections'), true);
    const colReadMatch = sql00005.match(/CREATE POLICY "Admin read collections"[\s\S]*?TO authenticated[\s\S]*?USING/);
    assert.notStrictEqual(colReadMatch, null, 'Admin read collections policy must contain "TO authenticated"');
    const colWriteMatch = sql00005.match(/CREATE POLICY "Admin write collections"[\s\S]*?TO authenticated[\s\S]*?USING/);
    assert.notStrictEqual(colWriteMatch, null, 'Admin write collections policy must contain "TO authenticated"');
  });

  it("public RLS policies do NOT invoke is_caller_active_admin_with_roles helper", () => {
    const sql00004 = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260809000004_wearables_catalogue_management.sql"),
      "utf-8",
    );
    const pubProdPolicy = sql00004.match(/CREATE POLICY "Public read published active products"[\s\S]*?;/);
    const pubVarPolicy = sql00004.match(/CREATE POLICY "Public read active variants of active products"[\s\S]*?;/);
    const pubColPolicy = sql00004.match(/CREATE POLICY "Public read published collections"[\s\S]*?;/);

    assert.notStrictEqual(pubProdPolicy, null);
    assert.notStrictEqual(pubVarPolicy, null);
    assert.notStrictEqual(pubColPolicy, null);

    if (pubProdPolicy) assert.strictEqual(pubProdPolicy[0].includes("is_caller_active_admin_with_roles"), false);
    if (pubVarPolicy) assert.strictEqual(pubVarPolicy[0].includes("is_caller_active_admin_with_roles"), false);
    if (pubColPolicy) assert.strictEqual(pubColPolicy[0].includes("is_caller_active_admin_with_roles"), false);
  });

  it("anon role is NOT granted EXECUTE privilege on is_caller_active_admin_with_roles", () => {
    const migrationFiles = [
      "supabase/migrations/20260808000000_ascend_hq_schema.sql",
      "supabase/migrations/20260809000000_fix_admin_profiles_rls.sql",
      "supabase/migrations/20260809000004_wearables_catalogue_management.sql",
      "supabase/migrations/20260809000005_fix_wearables_rls_policy_scope.sql",
    ];

    for (const file of migrationFiles) {
      const sqlContent = readFileSync(resolve(process.cwd(), file), "utf-8");
      const grantAnonMatch = sqlContent.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?is_caller_active_admin_with_roles[\s\S]*?TO[\s\S]*?anon/i);
      assert.strictEqual(grantAnonMatch, null, `File ${file} must NOT grant EXECUTE on is_caller_active_admin_with_roles to anon`);
    }
  });

  it("provider_cost_paise column privacy remains intact (not granted to anon or authenticated)", () => {
    const sql00004 = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260809000004_wearables_catalogue_management.sql"),
      "utf-8",
    );
    const sql00005 = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260809000005_fix_wearables_rls_policy_scope.sql"),
      "utf-8",
    );

    // 00004 revokes and grants explicit column list without provider_cost_paise
    assert.strictEqual(sql00004.includes("REVOKE ALL ON public.product_variants FROM PUBLIC, anon, authenticated;"), true);
    // 00005 does not alter table column grants
    assert.strictEqual(sql00005.includes("GRANT SELECT ON public.product_variants"), false);
  });

  it("RPC privileges for save_product_with_variants and save_collection_with_audit remain service_role only", () => {
    const sql00004 = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260809000004_wearables_catalogue_management.sql"),
      "utf-8",
    );

    assert.strictEqual(
      sql00004.includes("REVOKE ALL ON FUNCTION public.save_product_with_variants(JSONB, JSONB, UUID) FROM PUBLIC, anon, authenticated;"),
      true,
    );
    assert.strictEqual(
      sql00004.includes("GRANT EXECUTE ON FUNCTION public.save_product_with_variants(JSONB, JSONB, UUID) TO service_role;"),
      true,
    );
    assert.strictEqual(
      sql00004.includes("REVOKE ALL ON FUNCTION public.save_collection_with_audit(JSONB, UUID) FROM PUBLIC, anon, authenticated;"),
      true,
    );
    assert.strictEqual(
      sql00004.includes("GRANT EXECUTE ON FUNCTION public.save_collection_with_audit(JSONB, UUID) TO service_role;"),
      true,
    );
  });

  it("DropCartButton component has NO render-phase setState reset logic", () => {
    const buttonSrc = readFileSync(
      resolve(process.cwd(), "components/drop/DropCartButton.tsx"),
      "utf-8",
    );

    // Ensure render-phase state setters are absent
    assert.strictEqual(buttonSrc.includes("setLastProductSlug"), false);
    assert.strictEqual(buttonSrc.includes("setLastSizesKey"), false);
    assert.strictEqual(buttonSrc.includes("setLastColorsKey"), false);

    // Ensure component is structured with outer DropCartButton keying inner VariantSelector
    assert.strictEqual(buttonSrc.includes("function VariantSelector"), true);
    assert.strictEqual(buttonSrc.includes("<VariantSelector key={product.slug"), true);
  });
});

