import { getFeaturedDrop } from "@/lib/data/drops";

const featuredSlug = getFeaturedDrop().slug;

/** Multi-page brand routes — single source for nav and links. */
export const BRAND_ROUTES = {
  home: "/",
  philosophy: "/philosophy",
  wearables: "/wearables",
  drops: "/drops",
  journal: "/journal",
  collab: "/collab/nratlu",
  collabPrint: (id: string) => `/collab/nratlu#${id}` as const,
  drop: (slug: string) => `/drop/${slug}` as const,
  journalArticle: (slug: string) => `/journal/${slug}` as const,
  dropFeatured: `/drop/${featuredSlug}` as const,
  checkout: "/checkout",
} as const;

export type BrandNavItem = {
  href: string;
  label: string;
};

/** Global nav order — header, footer, and in-page explore links. */
export const BRAND_NAV: readonly BrandNavItem[] = [
  { href: BRAND_ROUTES.collab, label: "× NRATLU" },
  { href: BRAND_ROUTES.drops, label: "DROPS" },
  { href: BRAND_ROUTES.journal, label: "JOURNAL" },
  { href: BRAND_ROUTES.wearables, label: "WEARABLES" },
  { href: BRAND_ROUTES.philosophy, label: "PHILOSOPHY" },
] as const;

/**
 * Homepage portal — bottom-right stack (top → bottom visually).
 * Same sequence as BRAND_NAV; stagger runs bottom-up so the collab lands last.
 */
export const PORTAL_DIRECTIONS = BRAND_NAV.map((item, index) => ({
  ...item,
  stagger: `${((BRAND_NAV.length - index) * 0.2).toFixed(1)}s`,
}));

/** @deprecated Use BRAND_NAV or PORTAL_DIRECTIONS */
export const PORTAL_LINKS = BRAND_NAV;

export function isCommercePath(pathname: string): boolean {
  return (
    pathname === BRAND_ROUTES.checkout ||
    pathname === BRAND_ROUTES.drops ||
    pathname.startsWith("/drop/")
  );
}

export function isActiveBrandRoute(pathname: string, href: string): boolean {
  if (href === BRAND_ROUTES.home) return pathname === "/";
  if (href === BRAND_ROUTES.drops) {
    return pathname === href || pathname.startsWith("/drop/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
