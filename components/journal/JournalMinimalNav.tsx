"use client";

import { SocialLinks } from "@/components/brand/SocialLinks";
import { BRAND_NAV, BRAND_ROUTES } from "@/lib/brand/routes";
import Link from "next/link";
import { useState } from "react";
type JournalMinimalNavProps = {
  backHref?: string;
  backLabel?: string;
};

export function JournalMinimalNav({
  backHref = BRAND_ROUTES.journal,
  backLabel = "Journal",
}: JournalMinimalNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="journal-nav">
        <Link href={backHref} className="journal-nav__back">
          ← {backLabel}
        </Link>
        <button
          type="button"
          className="journal-nav__menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </header>

      {open ? (
        <div className="journal-nav__overlay" role="dialog" aria-modal>
          <nav className="journal-nav__overlay-inner" aria-label="Site">
            <Link href={BRAND_ROUTES.home} onClick={() => setOpen(false)}>
              Home
            </Link>
            {BRAND_NAV.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ))}
            <SocialLinks className="mt-6" />
          </nav>
        </div>
      ) : null}
    </>
  );
}
