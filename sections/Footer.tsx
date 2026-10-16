"use client";

import { SocialLinks } from "@/components/brand/SocialLinks";
import { FOOTER } from "@/lib/brand/content";
import { BRAND_NAV, BRAND_ROUTES } from "@/lib/brand/routes";
import Link from "next/link";
import { usePathname } from "next/navigation";

const legal = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/refunds", label: "Refunds" },
] as const;

export function Footer() {
  const pathname = usePathname();
  if (pathname === BRAND_ROUTES.home) return null;
  if (pathname.startsWith(`${BRAND_ROUTES.journal}/`)) return null;

  return (
    <footer id="site-footer" className="site-footer">
      <div className="brand-shell site-footer__inner">
        <div className="site-footer__row">
          <div className="site-footer__brand">
            <Link
              href={BRAND_ROUTES.home}
              className="brand-mark text-white/80 transition-colors hover:text-white"
            >
              ASCEND THEORY
            </Link>
            <p className="site-footer__tagline">{FOOTER.tagline}</p>
            <SocialLinks className="site-footer__social" />
          </div>

          <nav aria-label="Site" className="site-footer__nav">
            {BRAND_NAV.map((item) => (
              <Link key={item.href} href={item.href} className="site-footer__nav-link">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <p className="site-footer__closing">{FOOTER.closing}</p>

        <div className="site-footer__meta">
          <nav aria-label="Legal" className="site-footer__legal">
            {legal.map((item) => (
              <Link key={item.href} href={item.href} className="site-footer__legal-link">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
