"use client";

import { useCart } from "@/contexts/cart";
import { submitCreateOrder } from "@/lib/checkout/client";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import { formatMoney } from "@/lib/cart/format";
import {
  isOnlinePaymentAvailableClient,
  isRazorpayEnabledClient,
  isStripeEnabledClient,
} from "@/lib/payments/config";
import { event } from "@/lib/fpixel";
import { cn } from "@/lib/utils";
import { AscendImage } from "@/components/AscendImage";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CartTrust } from "./CartTrust";

export function CheckoutExperience() {
  const router = useRouter();
  const { resolvedLines, subtotal, currency, hydrated, clear } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkoutTracked = useRef(false);

  const onlineAvailable = isOnlinePaymentAvailableClient();

  useEffect(() => {
    if (!hydrated) return;
    if (resolvedLines.length === 0) {
      router.replace(BRAND_ROUTES.drops);
    }
  }, [hydrated, resolvedLines.length, router]);

  useEffect(() => {
    if (!hydrated || resolvedLines.length === 0 || checkoutTracked.current) return;
    checkoutTracked.current = true;
    event("InitiateCheckout", {
      content_ids: resolvedLines.map(({ product }) => product.slug),
      num_items: resolvedLines.reduce((n, { line }) => n + line.quantity, 0),
      value: subtotal,
      currency,
    });
  }, [hydrated, resolvedLines, subtotal, currency]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || resolvedLines.length === 0) return;

    const form = e.currentTarget;
    const data = new FormData(form);
    const paymentMethod =
      data.get("payment") === "online" && onlineAvailable ? "online" : "cod";

    const customer = {
      fullName: String(data.get("fullName") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      address: String(data.get("address") ?? "").trim(),
      city: String(data.get("city") ?? "").trim(),
      postalCode: String(data.get("postalCode") ?? "").trim(),
      country: String(data.get("country") ?? "").trim(),
    };

    setSubmitting(true);
    setError(null);

    try {
      const result = await submitCreateOrder({
        items: resolvedLines.map(({ line }) => ({
          slug: line.slug,
          variantId: line.variantId,
          sku: line.sku,
          size: line.size,
          color: line.color,
          quantity: line.quantity,
          // Do NOT send client price — server resolves authoritatively
        })),
        customer,
        paymentMethod,
        paymentProvider:
          paymentMethod === "online"
            ? isStripeEnabledClient()
              ? "stripe"
              : "razorpay"
            : undefined,
      });

      event("Purchase", {
        content_ids: result.order.items.map((i) => i.slug),
        value: result.order.subtotal,
        currency: result.order.currency,
        num_items: result.order.items.reduce((n, i) => n + i.quantity, 0),
      });

      clear();

      if (result.paymentUrl) {
        window.location.href = result.paymentUrl;
        return;
      }

      router.push(
        `/checkout/confirmation?orderId=${encodeURIComponent(result.order.id)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  if (!hydrated || resolvedLines.length === 0) {
    return (
      <div className="drop-shell py-32">
        <p className="brand-body text-white/50">Loading checkoutâ€¦</p>
      </div>
    );
  }

  return (
    <div className="drop-shell checkout-layout py-28 sm:py-32">
      <header className="checkout-header">
        <Link href={BRAND_ROUTES.drops} className="checkout-back">
          â† Back to drops
        </Link>
        <h1 className="brand-headline mt-8">Checkout</h1>
        <p className="brand-voice mt-4">Secure order Â· limited allocation</p>
      </header>

      <div className="checkout-grid">
        <form className="checkout-form" onSubmit={onSubmit}>
          <fieldset className="checkout-fieldset">
            <legend className="checkout-legend">Contact</legend>
            <label className="checkout-label">
              Full name
              <input
                className="checkout-input"
                name="fullName"
                type="text"
                required
                autoComplete="name"
              />
            </label>
            <label className="checkout-label">
              Email
              <input
                className="checkout-input"
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
              />
            </label>
            <label className="checkout-label">
              Phone
              <input
                className="checkout-input"
                name="phone"
                type="tel"
                required
                autoComplete="tel"
                inputMode="tel"
              />
            </label>
          </fieldset>

          <fieldset className="checkout-fieldset">
            <legend className="checkout-legend">Delivery</legend>
            <label className="checkout-label">
              Address
              <input
                className="checkout-input"
                name="address"
                type="text"
                required
                autoComplete="street-address"
              />
            </label>
            <div className="checkout-row">
              <label className="checkout-label">
                City
                <input
                  className="checkout-input"
                  name="city"
                  type="text"
                  required
                  autoComplete="address-level2"
                />
              </label>
              <label className="checkout-label">
                Postal code
                <input
                  className="checkout-input"
                  name="postalCode"
                  type="text"
                  required
                  autoComplete="postal-code"
                />
              </label>
            </div>
            <label className="checkout-label">
              Country
              <input
                className="checkout-input"
                name="country"
                type="text"
                required
                autoComplete="country-name"
              />
            </label>
          </fieldset>

          <fieldset className="checkout-fieldset">
            <legend className="checkout-legend">Payment</legend>
            <label className="checkout-radio">
              <input type="radio" name="payment" value="cod" defaultChecked />
              <span>Cash on Delivery</span>
            </label>
            {onlineAvailable ? (
              <label className="checkout-radio">
                <input type="radio" name="payment" value="online" />
                <span>
                  Pay online
                  {isStripeEnabledClient() ? " (Stripe)" : ""}
                  {isRazorpayEnabledClient() && !isStripeEnabledClient()
                    ? " (Razorpay)"
                    : ""}
                </span>
              </label>
            ) : null}
          </fieldset>

          {error ? <p className="checkout-error">{error}</p> : null}

          <CartTrust />
          <button
            type="submit"
            className={cn("drop-cta checkout-submit", submitting && "is-pending")}
            disabled={submitting}
          >
            {submitting ? "Processingâ€¦" : "Place order"}
          </button>
        </form>

        <aside className="checkout-summary" aria-label="Order summary">
          <p className="brand-eyebrow">Your order</p>
          <ul className="checkout-summary__lines">
            {resolvedLines.map(({ line, product }) => {
              const lineKey = line.variantId ?? line.sku ?? `${line.slug}-${line.size}-${line.color}`;
              const unitPrice = line.pricePaise != null ? line.pricePaise / 100 : product.price;
              const lineCurrency = line.currency ?? product.currency;
              return (
                <li key={lineKey} className="checkout-summary__line">
                  <div className="checkout-summary__thumb">
                    <AscendImage
                      src={product.image}
                      alt={product.name}
                      fill
                      sizes="72px"
                      className="object-cover"
                    />
                  </div>
                  <div className="checkout-summary__meta">
                    <Link
                      href={BRAND_ROUTES.drop(line.slug)}
                      className="checkout-summary__name"
                    >
                      {product.name}
                    </Link>
                    {(line.size || line.color) && (
                      <p className="checkout-summary__variant text-xs text-white/40 font-mono">
                        {[line.size, line.color].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <p className="checkout-summary__qty">Qty {line.quantity}</p>
                  </div>
                  <p className="checkout-summary__price">
                    {formatMoney(unitPrice * line.quantity, lineCurrency)}
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="checkout-summary__total">
            <span>Total</span>
            <span>{formatMoney(subtotal, currency)}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

