export type CartLine = {
  slug: string;
  quantity: number;
  /** Garment size for apparel with sizes (e.g. "M"). */
  size?: string;
};

/** Stable identity of a cart line — same product in two sizes is two lines. */
export function cartLineKey(line: { slug: string; size?: string }): string {
  return line.size ? `${line.slug}::${line.size}` : line.slug;
}

export type CartProduct = {
  slug: string;
  name: string;
  dropName: string;
  image: string;
  imageAlt: string;
  price: number;
  currency: string;
  priceDisplay: string;
  maxQuantity: number;
  /** When present, a size must be chosen before adding to cart. */
  sizes?: readonly string[];
};

export type CheckoutDetails = {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  payment: "cod" | "online";
};
