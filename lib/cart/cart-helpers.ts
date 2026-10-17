/**
 * Pure cart mutation helpers — no React, no browser APIs.
 * Extracted for unit testing and use by CartProvider.
 *
 * Cart identity rules:
 *   - variantId is the PRIMARY identity key for all new production lines.
 *   - SKU is a READ-ONLY fallback for migrating old persisted records.
 *   - Slug alone is NEVER a valid identity for production commerce.
 */

import type { CartLine } from "./types";

export const MAX_QUANTITY_DEFAULT = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the canonical identity key for a cart line.
 * Lines without variantId/sku produce a prefixed-invalid key so they can be
 * detected and excluded from checkout — they are NOT purchasable.
 */
export function lineIdentityKey(l: Pick<CartLine, "variantId" | "sku" | "slug" | "size" | "color">): string {
  if (l.variantId) return l.variantId;
  if (l.sku) return l.sku;
  return `__invalid__${l.slug ?? "unknown"}-${l.size ?? ""}-${l.color ?? ""}`;
}

/** True when a line is a slug-only (non-purchasable) entry. */
export function isLineInvalid(l: CartLine): boolean {
  return lineIdentityKey(l).startsWith("__invalid__");
}

function matchesKey(l: CartLine, key: string): boolean {
  return (
    lineIdentityKey(l) === key ||
    (l.variantId != null && l.variantId === key) ||
    (l.sku != null && l.sku === key)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Required-field validation
// ─────────────────────────────────────────────────────────────────────────────

export type AddProductFields = {
  slug: string;
  variantId: string;
  sku: string;
  size: string;
  color: string;
  quantity?: number;
  [key: string]: unknown;
};

/**
 * Returns true when all required variant identity fields are present and non-empty.
 * This is the runtime guard that supplements TypeScript.
 */
export function validateAddProductInput(
  input: Partial<AddProductFields>,
): input is AddProductFields {
  return (
    Boolean(input.slug) &&
    Boolean(input.variantId) &&
    Boolean(input.sku) &&
    Boolean(input.size) &&
    Boolean(input.color)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure mutations (operate on CartLine[] immutably)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a line to the cart, or increment its quantity if the same variantId already exists.
 * Returns a new array — does NOT mutate the input.
 *
 * Enforces:
 *   - variantId is the primary identity key for new lines
 *   - Quantity is at least 1
 *   - Total quantity is capped at maxQuantity
 */
export function applyAddProduct(
  lines: CartLine[],
  line: CartLine,
  maxQuantity: number = MAX_QUANTITY_DEFAULT,
): CartLine[] {
  const key = lineIdentityKey(line);
  const existingIndex = lines.findIndex((l) => matchesKey(l, key));

  if (existingIndex >= 0) {
    const existing = lines[existingIndex];
    const addQty = Math.max(1, line.quantity);
    const nextQty = Math.min(existing.quantity + addQty, maxQuantity);
    const copy = [...lines];
    copy[existingIndex] = { ...existing, quantity: nextQty };
    return copy;
  }

  return [...lines, { ...line, quantity: Math.max(1, line.quantity) }];
}

/**
 * Set the quantity of a line identified by variantKey.
 * qty < 1 removes the line.
 */
export function applySetQuantity(
  lines: CartLine[],
  variantKey: string,
  quantity: number,
  maxQuantity: number = MAX_QUANTITY_DEFAULT,
): CartLine[] {
  if (quantity < 1) {
    return lines.filter((l) => !matchesKey(l, variantKey));
  }
  return lines.map((l) => {
    if (!matchesKey(l, variantKey)) return l;
    const clamped = Math.min(Math.max(1, quantity), maxQuantity);
    return { ...l, quantity: clamped };
  });
}

/**
 * Remove a line identified by variantKey.
 */
export function applyRemoveLine(lines: CartLine[], variantKey: string): CartLine[] {
  return lines.filter((l) => !matchesKey(l, variantKey));
}

/**
 * Compute subtotal from lines given a price resolver.
 * Price resolver receives the line and returns price per unit in base currency units.
 */
export function computeSubtotal(
  lines: CartLine[],
  resolvePrice: (l: CartLine) => number,
): number {
  return lines.reduce((sum, l) => sum + resolvePrice(l) * l.quantity, 0);
}
