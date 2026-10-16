export type OrderStatus =
  | "created"
  | "pending_payment"
  | "pending_fulfillment"
  | "paid"
  | "processing"
  | "cancelled"
  | "refunded";

export type PaymentMethod = "cod" | "online";
export type PaymentProvider = "stripe" | "razorpay" | "none";

export type OrderCustomer = {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  addressLine1?: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
};

export type OrderItem = {
  orderItemId?: string;
  productId?: string;
  variantId?: string;
  slug: string;
  sku?: string;
  size?: string;
  color?: string;
  name: string;
  dropName: string;
  price: number;
  pricePaise?: number;
  priceDisplay: string;
  quantity: number;
  lineTotal: number;
  manufacturingIdentityHash?: string;
  manufacturingSnapshotJson?: Record<string, unknown>;
};

export type Order = {
  id: string;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentProvider: PaymentProvider;
  paymentStatus?: string;
  isCod?: boolean;
  currency: string;
  subtotal: number;
  items: OrderItem[];
  customer: OrderCustomer;
  shippingAddress?: OrderCustomer;
  /** External payment reference (Stripe session id, Razorpay order id) */
  paymentReference?: string;
  codStatus?: import("../cod/types").CodStatus;
  advanceRequired?: boolean;
  advanceAmountPaise?: number;
  advancePaymentId?: string;
  advanceStatus?: import("../cod/types").AdvanceStatus;
  codConfirmationTokenHash?: string;
  customerReadTokenHash?: string;
  fulfillment?: {
    provider?: "qikink" | "shopify" | "manual";
    externalId?: string;
  };
};

export type CreateOrderInput = {
  items: {
    slug: string;
    sku?: string;
    variantId?: string;
    size?: string;
    color?: string;
    price?: number;
    quantity: number;
  }[];
  customer: OrderCustomer;
  paymentMethod: PaymentMethod;
  paymentProvider?: PaymentProvider;
};

export type CreateOrderResult = {
  order: Order;
  /** Redirect URL for online payment (Stripe Checkout, etc.) */
  paymentUrl?: string;
  /** One-time customer confirmation token for COD authorization */
  confirmationToken?: string;
  /** One-time customer read capability token for order status read */
  customerReadToken?: string;
};
