"use client";

import { formatMoney } from "@/lib/cart/format";
import type { CartLine, CartProduct } from "@/lib/cart/types";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import { AscendImage } from "@/components/AscendImage";
import Link from "next/link";

type CartLineItemProps = {
  line: CartLine;
  product: CartProduct;
  onQuantityChange: (quantity: number) => void;
  onRemove?: () => void;
};

export function CartLineItem({
  line,
  product,
  onQuantityChange,
  onRemove,
}: CartLineItemProps) {
  // Prefer snapshot price from line; fall back to CartProduct price
  const unitPrice = line.pricePaise != null ? line.pricePaise / 100 : product.price;
  const currency = line.currency ?? product.currency;
  const total = unitPrice * line.quantity;
  const priceDisplay = line.priceDisplay ?? product.priceDisplay;

  return (
    <li className="cart-line">
      <Link
        href={BRAND_ROUTES.drop(line.slug)}
        className="cart-line__media"
        aria-label={`View ${product.name}`}
      >
        <AscendImage
          src={product.image}
          alt={product.imageAlt}
          fill
          sizes="96px"
          className="object-cover object-center"
        />
      </Link>

      <div className="cart-line__body">
        <p className="cart-line__drop">{product.dropName || product.name}</p>
        <Link href={BRAND_ROUTES.drop(line.slug)} className="cart-line__name">
          {product.name}
        </Link>

        {/* Variant badge: size / color */}
        {(line.size || line.color) && (
          <p className="cart-line__variant text-xs text-white/40 font-mono mt-0.5">
            {[line.size, line.color].filter(Boolean).join(" · ")}
          </p>
        )}

        <p className="cart-line__unit">{priceDisplay}</p>

        <div className="cart-line__qty">
          <button
            type="button"
            className="cart-qty-btn"
            aria-label="Decrease quantity"
            onClick={() => onQuantityChange(line.quantity - 1)}
          >
            −
          </button>
          <span className="cart-qty-value" aria-live="polite">
            {line.quantity}
          </span>
          <button
            type="button"
            className="cart-qty-btn"
            aria-label="Increase quantity"
            disabled={line.quantity >= product.maxQuantity}
            onClick={() => onQuantityChange(line.quantity + 1)}
          >
            +
          </button>
          {onRemove && (
            <button
              type="button"
              className="cart-qty-btn cart-qty-btn--remove"
              aria-label="Remove item"
              onClick={onRemove}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <p className="cart-line__total">
        {formatMoney(total, currency)}
      </p>
    </li>
  );
}
