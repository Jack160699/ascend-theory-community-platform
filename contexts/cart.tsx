"use client";

import { getCartProduct, getDefaultCartProduct } from "@/lib/cart/catalog";
import { cartSubtotal } from "@/lib/cart/format";
import { clearCart, readCart, writeCart } from "@/lib/cart/storage";
import { cartLineKey, type CartLine, type CartProduct } from "@/lib/cart/types";
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
  addDefaultProduct: () => void;
  addProduct: (slug: string, size?: string, options?: { openDrawer?: boolean }) => void;
  setQuantity: (key: string, quantity: number) => void;
  removeLine: (key: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function clampQuantity(product: CartProduct, qty: number): number {
  return Math.min(Math.max(1, qty), product.maxQuantity);
}

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

  const persist = useCallback((next: CartLine[]) => {
    setLines(next);
  }, []);

  const resolvedLines = useMemo((): ResolvedLine[] => {
    return lines
      .map((line) => {
        const product = getCartProduct(line.slug);
        if (!product) return null;
        return { line, product };
      })
      .filter((row): row is ResolvedLine => row !== null);
  }, [lines]);

  const itemCount = useMemo(
    () => resolvedLines.reduce((n, { line }) => n + line.quantity, 0),
    [resolvedLines],
  );

  const subtotal = useMemo(
    () => cartSubtotal(lines, getCartProduct),
    [lines],
  );

  const currency = resolvedLines[0]?.product.currency ?? "USD";

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const addProduct = useCallback((slug: string, size?: string, options?: { openDrawer?: boolean }) => {
    const product = getCartProduct(slug);
    if (!product) return;
    if (product.sizes?.length && (!size || !product.sizes.includes(size))) return;
    const chosenSize = product.sizes?.length ? size : undefined;
    const key = cartLineKey({ slug: product.slug, size: chosenSize });

    setLines((prev) => {
      const existing = prev.find((l) => cartLineKey(l) === key);
      if (existing) {
        const nextQty = clampQuantity(product, existing.quantity + 1);
        return prev.map((l) => (cartLineKey(l) === key ? { ...l, quantity: nextQty } : l));
      }
      const line: CartLine = chosenSize
        ? { slug: product.slug, quantity: 1, size: chosenSize }
        : { slug: product.slug, quantity: 1 };
      return [...prev, line];
    });

    event("AddToCart", {
      content_name: chosenSize ? `${product.name} — ${chosenSize}` : product.name,
      content_ids: [product.slug],
      content_type: "product",
      value: product.price,
      currency: product.currency,
    });

    if (options?.openDrawer !== false) setDrawerOpen(true);
  }, []);

  const addDefaultProduct = useCallback(() => {
    addProduct(getDefaultCartProduct().slug);
  }, [addProduct]);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((prev) => {
      const line = prev.find((l) => cartLineKey(l) === key);
      const product = line ? getCartProduct(line.slug) : undefined;
      if (!line || !product) return prev;
      if (quantity < 1) return prev.filter((l) => cartLineKey(l) !== key);
      const qty = clampQuantity(product, quantity);
      return prev.map((l) => (cartLineKey(l) === key ? { ...l, quantity: qty } : l));
    });
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => cartLineKey(l) !== key));
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
