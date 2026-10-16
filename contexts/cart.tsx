"use client";

import { getCartProductFromLine, getDefaultCartProduct } from "@/lib/cart/catalog";
import { clearCart, readCart, writeCart } from "@/lib/cart/storage";
import type { CartLine, CartProduct } from "@/lib/cart/types";
import { event } from "@/lib/fpixel";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Identity helper — exported for testing. */
export function getLineIdentity(l: Partial<CartLine>): string {
  // variantId is primary; SKU fallback supports legacy persisted cart records
  if (l.variantId) return l.variantId;
  if (l.sku) return l.sku;
  // Slug-only lines are surfaced as unavailable; they must not be purchasable.
  return `__invalid__${l.slug ?? "unknown"}-${l.size ?? "nosize"}-${l.color ?? "nocolor"}`;
}

/** Returns true when a line's identity key indicates it was a slug-only entry. */
export function isInvalidLine(l: CartLine): boolean {
  return getLineIdentity(l).startsWith("__invalid__");
}

function matchesKey(l: CartLine, key: string): boolean {
  return (
    getLineIdentity(l) === key ||
    (l.variantId != null && l.variantId === key) ||
    (l.sku != null && l.sku === key)
  );
}

function clampQuantity(product: CartProduct, qty: number): number {
  return Math.min(Math.max(1, qty), product.maxQuantity);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Production addProduct MUST supply exact variant identity.
 * variantId + sku + size + color are all required for production commerce.
 * Optional display snapshot fields allow cart rendering without static CATALOG.
 */
export type AddProductInput = {
  slug: string;
  variantId: string;   // REQUIRED — primary cart identity key
  sku: string;          // REQUIRED — used as fallback key and checkout payload
  size: string;         // REQUIRED — variant attribute
  color: string;        // REQUIRED — variant attribute
  quantity?: number;
  // Display snapshot (for DB-backed products not in static CATALOG)
  title?: string;
  image?: string;
  priceDisplay?: string;
  currency?: string;
  pricePaise?: number;
};

type ResolvedLine = { line: CartLine; product: CartProduct };

type CartContextValue = {
  hydrated: boolean;
  lines: CartLine[];
  resolvedLines: ResolvedLine[];
  itemCount: number;
  subtotal: number;
  currency: string;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  /** DEV ONLY — adds a default product without variant identity. Never call in production commerce. */
  addDefaultProduct: () => void;
  addProduct: (input: AddProductInput) => void;
  setQuantity: (variantKey: string, quantity: number) => void;
  removeLine: (variantKey: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const stored = readCart();
    const id = window.requestAnimationFrame(() => {
      setLines(stored);
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeCart(lines);
  }, [lines, hydrated]);

  const resolvedLines = useMemo((): ResolvedLine[] => {
    return lines
      .filter((l) => !isInvalidLine(l)) // invalid lines not purchasable
      .map((line) => {
        const product = getCartProductFromLine(line);
        if (!product) return null;
        return { line, product };
      })
      .filter((row): row is ResolvedLine => row !== null);
  }, [lines]);

  const itemCount = useMemo(
    () => resolvedLines.reduce((n, { line }) => n + line.quantity, 0),
    [resolvedLines],
  );

  const subtotal = useMemo(() => {
    let total = 0;
    for (const { line, product } of resolvedLines) {
      if (line.pricePaise != null) {
        total += (line.pricePaise / 100) * line.quantity;
      } else {
        total += product.price * line.quantity;
      }
    }
    return total;
  }, [resolvedLines]);

  const currency = resolvedLines[0]?.line.currency ?? resolvedLines[0]?.product.currency ?? "INR";

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const addProduct = useCallback((input: AddProductInput) => {
    // Runtime validation — TypeScript alone is not sufficient (data may come from external callers)
    if (!input.variantId || !input.sku || !input.size || !input.color) {
      if (process.env.NODE_ENV !== "production") {
        console.error(
          "[Cart] addProduct called without required variant identity (variantId, sku, size, color). Rejected.",
          input,
        );
      }
      return; // fail-closed: do not create invalid line
    }

    const lineObj: CartLine = {
      slug: input.slug,
      sku: input.sku,
      variantId: input.variantId,
      size: input.size,
      color: input.color,
      quantity: Math.max(1, input.quantity || 1),
      title: input.title,
      image: input.image,
      priceDisplay: input.priceDisplay,
      currency: input.currency,
      pricePaise: input.pricePaise,
    };

    // variantId is always the key for new production lines
    const targetKey = input.variantId;

    setLines((prev) => {
      const existingIndex = prev.findIndex((l) => matchesKey(l, targetKey));
      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        const product = getCartProductFromLine(existing);
        const addQty = lineObj.quantity;
        const nextQty = product
          ? clampQuantity(product, existing.quantity + addQty)
          : existing.quantity + addQty;

        const copy = [...prev];
        copy[existingIndex] = { ...existing, quantity: nextQty };
        return copy;
      }
      return [...prev, lineObj];
    });

    const product = getCartProductFromLine(lineObj);
    if (product) {
      event("AddToCart", {
        content_name: product.name,
        content_ids: [lineObj.variantId || lineObj.sku || product.slug],
        content_type: "product",
        value: product.price,
        currency: product.currency,
      });
    }

    setDrawerOpen(true);
  }, []);

  /**
   * DEV ONLY — adds a default product without full variant identity.
   * This path must never be called in production commerce flows.
   * It exists solely for local visual development of cart UI.
   */
  const addDefaultProduct = useCallback(() => {
    if (process.env.NODE_ENV === "production") {
      console.error("[Cart] addDefaultProduct is not allowed in production.");
      return;
    }
    const def = getDefaultCartProduct();
    // addDefaultProduct bypasses the required-field check intentionally for dev
    const lineObj: CartLine = {
      slug: def.slug,
      title: def.name,
      image: def.image,
      priceDisplay: def.priceDisplay,
      currency: def.currency,
      pricePaise: Math.round(def.price * 100),
      quantity: 1,
    };
    setLines((prev) => [...prev, lineObj]);
    setDrawerOpen(true);
  }, []);

  /**
   * Set quantity by variantId (primary) or SKU (fallback for legacy records).
   * qty < 1 removes the line.
   */
  const setQuantity = useCallback((variantKey: string, quantity: number) => {
    setLines((prev) => {
      if (quantity < 1) {
        return prev.filter((l) => !matchesKey(l, variantKey));
      }
      return prev.map((l) => {
        if (!matchesKey(l, variantKey)) return l;
        const product = getCartProductFromLine(l);
        const qty = product ? clampQuantity(product, quantity) : quantity;
        return { ...l, quantity: qty };
      });
    });
  }, []);

  /**
   * Remove line by variantId (primary) or SKU (fallback).
   */
  const removeLine = useCallback((variantKey: string) => {
    setLines((prev) => prev.filter((l) => !matchesKey(l, variantKey)));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    clearCart();
  }, []);

  const value = useMemo(
    (): CartContextValue => ({
      hydrated,
      lines,
      resolvedLines,
      itemCount,
      subtotal,
      currency,
      drawerOpen,
      openDrawer,
      closeDrawer,
      addDefaultProduct,
      addProduct,
      setQuantity,
      removeLine,
      clear,
    }),
    [
      hydrated,
      lines,
      resolvedLines,
      itemCount,
      subtotal,
      currency,
      drawerOpen,
      openDrawer,
      closeDrawer,
      addDefaultProduct,
      addProduct,
      setQuantity,
      removeLine,
      clear,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within CartProvider");
  }
  return ctx;
}
