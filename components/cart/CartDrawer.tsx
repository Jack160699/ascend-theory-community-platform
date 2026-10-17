"use client";

import { useCart } from "@/contexts/cart";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import { formatMoney } from "@/lib/cart/format";
import { lockModalScroll } from "@/lib/modal-scroll-lock";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { CartLineItem } from "./CartLineItem";
import { CartTrust } from "./CartTrust";
import { CartUrgency } from "./CartUrgency";

export function CartDrawer() {
  const {
    drawerOpen,
    closeDrawer,
    resolvedLines,
    subtotal,
    currency,
    setQuantity,
    removeLine,
    hydrated,
  } = useCart();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    return lockModalScroll();
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  useEffect(() => {
    if (!drawerOpen || !panelRef.current) return;
    panelRef.current.focus();
  }, [drawerOpen]);

  const empty = hydrated && resolvedLines.length === 0;

  return (
    <div
      className={cn("cart-drawer", drawerOpen && "cart-drawer--open")}
      aria-hidden={!drawerOpen}
    >
      <button
        type="button"
        className="cart-drawer__backdrop"
        aria-label="Close cart"
        onClick={closeDrawer}
        tabIndex={drawerOpen ? 0 : -1}
      />

      <aside
        ref={panelRef}
        className="drop-cart-panel cart-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        tabIndex={-1}
      >
        <header className="cart-drawer__header">
          <div>
            <h2 className="cart-drawer__title">Cart</h2>
            <CartUrgency compact />
          </div>
          <button
            type="button"
            className="cart-drawer__close"
            onClick={closeDrawer}
            aria-label="Close"
          >
            Close
          </button>
        </header>

        <div className="cart-drawer__scroll">
          {empty ? (
            <p className="cart-drawer__empty">Your cart is empty.</p>
          ) : (
            <ul className="cart-drawer__lines">
              {resolvedLines.map(({ line, product }) => {
                // Primary key: variantId; SKU fallback; slug-size-color last resort
                const lineKey = line.variantId ?? line.sku ?? `${line.slug}-${line.size}-${line.color}`;
                const quantityKey = line.variantId ?? line.sku ?? line.slug;
                return (
                  <CartLineItem
                    key={lineKey}
                    line={line}
                    product={product}
                    onQuantityChange={(qty) => setQuantity(quantityKey, qty)}
                    onRemove={() => removeLine(quantityKey)}
                  />
                );
              })}
            </ul>
          )}
        </div>

        <footer className="cart-drawer__footer">
          <div className="cart-drawer__total-row">
            <span className="cart-drawer__total-label">Total</span>
            <span className="cart-drawer__total-value">
              {formatMoney(subtotal, currency)}
            </span>
          </div>

          <CartTrust />

          {empty ? (
            <Link
              href={BRAND_ROUTES.drops}
              className="drop-cta cart-drawer__checkout"
              onClick={closeDrawer}
            >
              View drops
            </Link>
          ) : (
            <Link
              href={BRAND_ROUTES.checkout}
              className="drop-cta cart-drawer__checkout"
              onClick={closeDrawer}
            >
              Checkout
            </Link>
          )}
        </footer>
      </aside>
    </div>
  );
}
