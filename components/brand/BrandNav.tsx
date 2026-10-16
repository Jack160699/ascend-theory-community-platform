"use client";

import { SocialLinks } from "@/components/brand/SocialLinks";
import { CartNavButton } from "@/components/cart/CartNavButton";
import { useAssessmentModal } from "@/contexts/assessment-modal";
import {
  BRAND_NAV,
  BRAND_ROUTES,
  isActiveBrandRoute,
  isCommercePath,
} from "@/lib/brand/routes";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function BrandNav() {
  const pathname = usePathname();
  const isPortalHome = pathname === BRAND_ROUTES.home;
  const showCart = isCommercePath(pathname);
  const { openAssessment } = useAssessmentModal();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isPortalHome) return;
    const onScroll = () => setScrolled(window.scrollY > 32);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isPortalHome]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (isPortalHome) {
    return null;
  }

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-[100] transition-[background-color,border-color] duration-500 ease-[cubic-bezier(0.33,1,0.68,1)]",
          scrolled
            ? "border-b border-white/[0.06] bg-[#0a0a0a]/90 backdrop-blur-md"
            : "border-b border-transparent bg-transparent",
        )}
      >
        <nav
          className="brand-shell flex h-[4.25rem] items-center justify-between sm:h-[4.5rem]"
          aria-label="Primary"
        >
          <Link href={BRAND_ROUTES.home} className="brand-mark text-white/50 hover:text-white/80">
            ASCEND THEORY
          </Link>

          <div className="hidden items-center gap-8 lg:flex">
            {BRAND_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "text-[12px] font-medium tracking-[0.06em] transition-colors",
                  isActiveBrandRoute(pathname, item.href)
                    ? "text-white/90"
                    : "text-white/45 hover:text-white/85",
                )}
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => openAssessment()}
              className="text-[12px] font-medium tracking-[0.06em] text-white transition-opacity hover:opacity-85"
            >
              APPLY
            </button>
            {showCart ? <CartNavButton /> : null}
          </div>

          <div className="flex items-center gap-4 lg:hidden">
            {showCart ? <CartNavButton /> : null}
            <button
              type="button"
              className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/55"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Close" : "Menu"}
            </button>
          </div>
        </nav>
      </header>

      {open ? (
        <div
          className="fixed inset-0 z-[95] bg-[#0a0a0a]/96 backdrop-blur-sm lg:hidden"
          role="dialog"
          aria-modal
        >
          <div className="flex min-h-full flex-col justify-center gap-6 px-8">
            {BRAND_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "text-2xl font-medium tracking-tight",
                  isActiveBrandRoute(pathname, item.href) ? "text-white" : "text-white/90",
                )}
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openAssessment();
              }}
              className="text-2xl font-medium tracking-tight text-white"
            >
              APPLY
            </button>
            <SocialLinks className="mt-4" />
          </div>
        </div>
      ) : null}
    </>
  );
}

