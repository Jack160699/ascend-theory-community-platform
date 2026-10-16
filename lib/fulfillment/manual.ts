import type { FulfillmentAdapter, FulfillmentResult } from "./types";
import type { Order } from "@/lib/orders/types";

/** Default fulfillment — logs order for manual / future pipeline. */
export class ManualFulfillmentAdapter implements FulfillmentAdapter {
  readonly provider = "manual" as const;

  async submitOrder(order: Order): Promise<FulfillmentResult> {
    console.info("[fulfillment:manual]", order.id, {
      items: order.items.map((i) => `${i.slug}${i.size ? `/${i.size}` : ""}×${i.quantity}`),
      customer: order.customer.email,
    });
    return { provider: "manual", status: "queued" };
  }
}
