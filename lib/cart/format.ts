import type { CartLine, CartProduct } from "./types";

export function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function lineTotal(product: CartProduct, quantity: number): number {
  return product.price * quantity;
}

export function cartSubtotal(
  lines: CartLine[],
  resolve: (slug: string) => CartProduct | undefined,
): number {
  return lines.reduce((sum, line) => {
    const product = resolve(line.slug);
    if (!product) return sum;
    return sum + lineTotal(product, line.quantity);
  }, 0);
}

export function formatOrderWhatsAppBody(input: {
  lines: { product: CartProduct; quantity: number; size?: string }[];
  subtotal: number;
  currency: string;
  customer: {
    fullName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    postalCode: string;
    country: string;
  };
  payment: "cod" | "online";
}): string {
  const items = input.lines
    .map(
      (l) =>
        `· ${l.product.name}${l.size ? ` — Size ${l.size}` : ""} (${l.product.dropName}) × ${l.quantity} — ${formatMoney(lineTotal(l.product, l.quantity), input.currency)}`,
    )
    .join("\n");

  const paymentLabel =
    input.payment === "cod" ? "Cash on Delivery" : "Online payment";

  return [
    "Hi Ascend Theory,",
    "",
    "I’d like to place an order from the limited drop:",
    "",
    items,
    "",
    `Total: ${formatMoney(input.subtotal, input.currency)}`,
    `Payment: ${paymentLabel}`,
    "",
    "Delivery details:",
    input.customer.fullName,
    input.customer.phone,
    input.customer.email,
    input.customer.address,
    `${input.customer.city}, ${input.customer.postalCode}`,
    input.customer.country,
    "",
    "— Sent from Ascend Theory checkout",
  ].join("\n");
}
