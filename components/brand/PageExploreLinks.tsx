import { SocialLinks } from "@/components/brand/SocialLinks";
import { BRAND_NAV } from "@/lib/brand/routes";
import { cn } from "@/lib/utils";
import Link from "next/link";

type PageExploreLinksProps = {
  /** Exclude current page from the list */
  excludeHref?: string;
  className?: string;
};

/** Closing cross-links on every page — every section plus both Instagram pages. */
export function PageExploreLinks({ excludeHref, className }: PageExploreLinksProps) {
  const links = excludeHref
    ? BRAND_NAV.filter((item) => item.href !== excludeHref)
    : BRAND_NAV;

  return (
    <nav className={cn("page-explore", className)} aria-label="Explore the brand">
      <p className="brand-eyebrow">Explore</p>
      <ul className="page-explore__list">
        {links.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="page-explore__link group">
              <span>{item.label}</span>
              <span className="page-explore__arrow" aria-hidden>
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="page-explore__social">
        <p className="brand-eyebrow">Follow the drop</p>
        <SocialLinks />
      </div>
    </nav>
  );
}
