import { Layers, LayoutDashboard, Link2, Palette, Shirt, ShoppingBag, Truck, Wallet } from "lucide-react";
import type { HqNavItem } from "@/lib/admin/nav";

const ICONS = {
  dashboard: LayoutDashboard,
  orders: ShoppingBag,
  products: Shirt,
  collections: Layers,
  designs: Palette,
  skus: Link2,
  fulfilment: Truck,
  cod: Wallet,
} as const;

export function AdminNavIcon({ icon, className }: { icon: HqNavItem["icon"]; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={className} aria-hidden="true" />;
}
