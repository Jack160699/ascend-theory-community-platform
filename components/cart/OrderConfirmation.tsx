"use client";

import { BRAND_ROUTES } from "@/lib/brand/routes";
import {
  clearOrderSnapshot,
  fetchOrder,
  readOrderSnapshot,
} from "@/lib/checkout/client";
import { formatMoney } from "@/lib/cart/format";
import type { Order } from "@/lib/orders/types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function OrderConfirmation() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId") ?? "";
  const paidFlag = searchParams.get("paid") === "1";

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) {
      const id = window.requestAnimationFrame(() => setLoading(false));
      return () => window.cancelAnimationFrame(id);
    }

    let cancelled = false;

    async function load() {
      if (paidFlag) {
        try {
          await fetch("/api/orders/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId }),
          });
        } catch {
          /* continue with snapshot */
        }
      }

      const snapshot = readOrderSnapshot();
      const fetched = await fetchOrder(orderId);
      if (!cancelled) {
        setOrder(fetched ?? (snapshot?.id === orderId ? snapshot : null));
        setLoading(false);
        clearOrderSnapshot();
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [orderId, paidFlag]);

  if (loading) {
    return (
      <div className="drop-shell py-32">
        <p className="brand-body text-white/50">Confirming your order…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="drop-shell py-32 max-w-lg">
        <p className="brand-eyebrow">Order</p>
        <h1 className="brand-headline mt-6">We could not load this order.</h1>
        <Link href={BRAND_ROUTES.drops} className="brand-wearables-cta mt-10 inline-flex">
          Return to drops →
        </Link>
      </div>
    );
  }

  const isPaid = order.status === "paid";
  const isCod = order.paymentMethod === "cod";

  return (
    <div className="drop-shell order-confirmation py-28 sm:py-32 max-w-xl">
      <p className="brand-eyebrow">Order confirmed</p>
      <h1 className="brand-headline mt-6">
        {isPaid ? "Payment received." : isCod ? "Order placed." : "Thank you."}
      </h1>
      <p className="brand-voice mt-6">
        {isCod
          ? "We will confirm delivery by email. Cash on delivery."
          : isPaid
            ? "Your allocation is secured. Confirmation sent to your email."
            : "Your order is recorded. We will follow up shortly."}
      </p>

      <p className="order-confirmation__id mt-8">Order {order.id}</p>

      <ul className="order-confirmation__items mt-8">
        {order.items.map((item) => (
          <li key={`${item.slug}-${item.size ?? ""}`} className="order-confirmation__item">
            <div>
              <p className="order-confirmation__name">{item.name}</p>
              <p className="brand-prose-tight mt-1">
                {item.dropName}
                {item.size ? ` · Size ${item.size}` : ""} · Qty {item.quantity}
              </p>
            </div>
            <p className="order-confirmation__price">
              {formatMoney(item.lineTotal, order.currency)}
            </p>
          </li>
        ))}
      </ul>

      <div className="order-confirmation__total">
        <span>Total</span>
        <span>{formatMoney(order.subtotal, order.currency)}</span>
      </div>

      <div className="order-confirmation__customer mt-10">
        <p className="brand-eyebrow">Delivery</p>
        <p className="brand-voice mt-3">
          {order.customer.fullName}
          <br />
          {order.customer.address}
          <br />
          {order.customer.city}, {order.customer.postalCode}
          <br />
          {order.customer.country}
        </p>
      </div>

      <Link href={BRAND_ROUTES.drops} className="drop-cta order-confirmation__cta mt-12 inline-flex">
        Continue shopping
      </Link>
    </div>
  );
}
