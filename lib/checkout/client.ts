import type { CreateOrderInput } from "@/lib/orders/types";
import type { Order } from "@/lib/orders/types";

const ORDER_SNAPSHOT_KEY = "ascend-order-snapshot";

export type CreateOrderResponse = {
  order: Order;
  confirmationToken?: string;
  customerReadToken?: string;
  paymentUrl: string | null;
};

export async function submitCreateOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResponse> {
  const res = await fetch("/api/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = (await res.json()) as CreateOrderResponse & { error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? "Order could not be created.");
  }

  saveOrderSnapshot(data.order);
  if (data.confirmationToken && data.order?.id) {
    saveCodConfirmationToken(data.order.id, data.confirmationToken);
  }
  if (data.customerReadToken && data.order?.id) {
    saveCustomerReadToken(data.order.id, data.customerReadToken);
  }
  return data;
}

export function saveOrderSnapshot(order: Order): void {
  try {
    sessionStorage.setItem(ORDER_SNAPSHOT_KEY, JSON.stringify(order));
  } catch {
    /* private mode */
  }
}

export function readOrderSnapshot(): Order | null {
  try {
    const raw = sessionStorage.getItem(ORDER_SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Order;
  } catch {
    return null;
  }
}

export function clearOrderSnapshot(): void {
  try {
    sessionStorage.removeItem(ORDER_SNAPSHOT_KEY);
  } catch {
    /* noop */
  }
}

export async function fetchOrder(orderId: string): Promise<Order | null> {
  const codToken = readCodConfirmationToken(orderId);
  const readToken = readCustomerReadToken(orderId);
  const headers: Record<string, string> = {};
  if (codToken) {
    headers["x-ascend-confirmation-token"] = codToken;
  }
  if (readToken) {
    headers["x-ascend-customer-read-token"] = readToken;
  }
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { headers });
  if (!res.ok) return readOrderSnapshot();
  const data = (await res.json()) as { order: Order };
  return data.order;
}

const COD_TOKEN_PREFIX = "ascend-cod-confirmation-token:";
const READ_TOKEN_PREFIX = "ascend-customer-read-token:";

export function saveCodConfirmationToken(orderId: string, token: string): void {
  try {
    sessionStorage.setItem(`${COD_TOKEN_PREFIX}${orderId}`, token);
  } catch {
    /* private mode */
  }
}

export function readCodConfirmationToken(orderId: string): string | null {
  try {
    return sessionStorage.getItem(`${COD_TOKEN_PREFIX}${orderId}`);
  } catch {
    return null;
  }
}

export function clearCodConfirmationToken(orderId: string): void {
  try {
    sessionStorage.removeItem(`${COD_TOKEN_PREFIX}${orderId}`);
  } catch {
    /* noop */
  }
}

export function saveCustomerReadToken(orderId: string, token: string): void {
  try {
    sessionStorage.setItem(`${READ_TOKEN_PREFIX}${orderId}`, token);
  } catch {
    /* private mode */
  }
}

export function readCustomerReadToken(orderId: string): string | null {
  try {
    return sessionStorage.getItem(`${READ_TOKEN_PREFIX}${orderId}`);
  } catch {
    return null;
  }
}

export function clearCustomerReadToken(orderId: string): void {
  try {
    sessionStorage.removeItem(`${READ_TOKEN_PREFIX}${orderId}`);
  } catch {
    /* noop */
  }
}
