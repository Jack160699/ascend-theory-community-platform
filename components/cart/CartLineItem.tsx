"use client";

import { formatMoney, lineTotal } from "@/lib/cart/format";
import type { CartLine, CartProduct } from "@/lib/cart/types";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import { AscendImage } from "@/components/AscendImage";
import Link from "next/link";

type CartLineItemProps = {
  line: CartLine;
  product: CartProduct;
  onQuantityChange: (quantity: number) => void;
};

export function CartLineItem({
  line,
  product,
  onQuantityChange,
}: CartLineItemProps) {
  const total = lineTotal(product, line.quantity);

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
        <p className="cart-line__drop">{product.dropName}</p>
        <Link href={BRAND_ROUTES.drop(line.slug)} className="cart-line__name">
          {product.name}
        </Link>
        <p className="cart-line__unit">
          {line.size ? <span className="cart-line__size">Size {line.size} · </span> : null}
          {product.priceDisplay}
        </p>

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
        </div>
      </div>

      <p className="cart-line__total">
        {formatMoney(total, product.currency)}
      </p>
    </li>
  );
}
