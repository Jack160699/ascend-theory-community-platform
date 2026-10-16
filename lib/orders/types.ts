export type OrderStatus =
  | "pending_payment"
  | "pending_fulfillment"
  | "paid"
  | "cancelled";

export type PaymentMethod = "cod" | "online";
export type PaymentProvider = "stripe" | "razorpay" | "none";

export type OrderCustomer = {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
};

export type OrderItem = {
  slug: string;
  name: string;
  dropName: string;
  price: number;
  priceDisplay: string;
  quantity: number;
  lineTotal: number;
  size?: string;
};

export type Order = {
  id: string;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentProvider: PaymentProvider;
  currency: string;
  subtotal: number;
  items: OrderItem[];
  customer: OrderCustomer;
  /** External payment reference (Stripe session id, Razorpay order id) */
  paymentReference?: string;
  fulfillment?: {
    provider?: "qikink" | "shopify" | "manual";
    externalId?: string;
  };
};

export type CreateOrderInput = {
  items: { slug: string; quantity: number; size?: string }[];
  customer: OrderCustomer;
  paymentMethod: PaymentMethod;
  paymentProvider?: PaymentProvider;
};

export type CreateOrderResult = {
  order: Order;
  /** Redirect URL for online payment (Stripe Checkout, etc.) */
  paymentUrl?: string;
};
