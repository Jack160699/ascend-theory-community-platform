/** Ascend HQ navigation — only pages that do real work. */

export type HqNavItem = {
  href: string;
  label: string;
  description: string;
  icon: "dashboard" | "orders" | "products" | "collections" | "designs" | "skus" | "fulfilment" | "cod";
};

export const HQ_NAV: HqNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard", description: "Sales, orders and stock at a glance." },
  { href: "/admin/orders", label: "Orders", icon: "orders", description: "Every order, its payment and where it is." },
  {
    href: "/admin/wearables/products",
    label: "Products",
    icon: "products",
    description: "Tees, prices, colours, sizes and stock.",
  },
  {
    href: "/admin/wearables/collections",
    label: "Collections",
    icon: "collections",
    description: "Drops that group products on the site.",
  },
  {
    href: "/admin/wearables/design-studio",
    label: "Designs",
    icon: "designs",
    description: "Print artwork, placement and mockups.",
  },
  {
    href: "/admin/wearables/pod-mapping",
    label: "Qikink SKUs",
    icon: "skus",
    description: "Link each colour and size to Qikink's SKU.",
  },
  {
    href: "/admin/wearables/fulfillment",
    label: "Fulfilment",
    icon: "fulfilment",
    description: "Send orders to Qikink and track shipments.",
  },
  {
    href: "/admin/commerce/cod",
    label: "Cash on delivery",
    icon: "cod",
    description: "Approve or hold COD orders.",
  },
];

export function navItemForPath(pathname: string): HqNavItem | undefined {
  if (pathname === "/admin") return HQ_NAV[0];
  return HQ_NAV.filter((i) => i.href !== "/admin" && pathname.startsWith(i.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}

export function isNavItemActive(item: HqNavItem, pathname: string): boolean {
  return item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
}
