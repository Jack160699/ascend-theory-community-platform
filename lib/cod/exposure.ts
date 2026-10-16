/**
 * Phase 7 — Daily COD Exposure Calculation (Requirements #10 & #30)
 * Computes outstanding active COD liability placed today in Asia/Kolkata timezone.
 * Active COD states: COD_APPROVED, COD_CONFIRMED, COD_ADVANCE_PENDING.
 */

import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Order } from "@/lib/orders/types";
import { getAllOrdersAdmin } from "@/lib/orders/store";

export const DEFAULT_MAX_DAILY_COD_EXPOSURE_PAISE = 5000000; // ₹50,000 default daily COD liability cap

/**
 * Returns today's YYYY-MM-DD date string in Asia/Kolkata timezone.
 */
export function getTodayKolkataDateString(): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  const parts = new Intl.DateTimeFormat("en-CA", options).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

/**
 * Calculates current outstanding active COD liability placed today in Asia/Kolkata timezone.
 */
export async function getDailyCodExposureAdmin(): Promise<number> {
  const todayKolkata = getTodayKolkataDateString();

  if (hasSupabaseConfig()) {
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      throw new Error("[Exposure] Supabase service role client unconfigured.");
    }

    const { data, error } = await supabase
      .from("orders")
      .select("total_paise, subtotal_paise, created_at, cod_status, payment_method")
      .eq("payment_method", "cod")
      .in("cod_status", ["COD_APPROVED", "COD_CONFIRMED", "COD_ADVANCE_PENDING"]);

    if (error) {
      console.error("[Exposure] DB error calculating daily COD exposure:", error);
      throw new Error(`Failed to calculate daily exposure from Supabase: ${error.message}`);
    }

    return (data || [])
      .filter((row: { created_at: string }) => {
        const rowKolkataDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(row.created_at));
        return rowKolkataDate === todayKolkata;
      })
      .reduce(
        (sum: number, row: { total_paise?: number; subtotal_paise?: number }) =>
          sum + Number(row.total_paise || row.subtotal_paise || 0),
        0,
      );
  }

  // Memory fallback for dev/testing
  const allOrders = await getAllOrdersAdmin();
  return allOrders
    .filter((o: Order) => {
      if (
        (o.paymentMethod === "cod" || o.isCod) &&
        ["COD_APPROVED", "COD_CONFIRMED", "COD_ADVANCE_PENDING"].includes(o.codStatus || "") &&
        o.createdAt
      ) {
        const orderKolkataDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(o.createdAt));
        return orderKolkataDate === todayKolkata;
      }
      return false;
    })
    .reduce((sum: number, o: Order) => sum + Math.round((o.subtotal || 0) * 100), 0);
}
