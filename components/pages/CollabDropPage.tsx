"use client";

import { AscendImage } from "@/components/AscendImage";
import { BrandSiteLayout } from "@/components/brand/layout/BrandSiteLayout";
import { PageExploreLinks } from "@/components/brand/PageExploreLinks";
import { InstagramGlyph, SocialLinks } from "@/components/brand/SocialLinks";
import { useCinematicScroll } from "@/contexts/cinematic-scroll";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import type { Collab, CollabPrint } from "@/lib/data/collabs";
import { DROPS } from "@/lib/data/drops";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

/** Clearance for the fixed brand header + sticky print index. */
const ANCHOR_OFFSET = 132;

function useAnchorScroll() {
  const { lenis } = useCinematicScroll();

  const scrollToId = useCallback(
    (id: string, smooth = true) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (lenis) {
        lenis.scrollTo(el, { offset: -ANCHOR_OFFSET, immediate: !smooth });
      } else {
        const top = el.getBoundingClientRect().top + window.scrollY - ANCHOR_OFFSET;
        window.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
      }
    },
    [lenis],
  );

  // Arriving from another page with `/collab/nratlu#print-02`.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const frame = requestAnimationFrame(() => scrollToId(id, false));
    return () => cancelAnimationFrame(frame);
  }, [scrollToId]);

  return scrollToId;
}

function AnchorLink({
  id,
  className,
  children,
  onNavigate,
  ariaLabel,
}: {
  id: string;
  className?: string;
  children: ReactNode;
  onNavigate: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <a
      href={`#${id}`}
      aria-label={ariaLabel}
      className={className}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        window.history.replaceState(null, "", `#${id}`);
        onNavigate(id);
      }}
    >
      {children}
    </a>
  );
}

function useActivePrint(ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-35% 0px -45% 0px", threshold: [0, 0.25, 0.5] },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

function PrintSection({
  print,
  index,
  collab,
  onNavigate,
}: {
  print: CollabPrint;
  index: number;
  collab: Collab;
  onNavigate: (id: string) => void;
}) {
  const prev = collab.prints[index - 1];
  const next = collab.prints[index + 1];
  const isTall = print.ratio < 0.8;

  return (
    <section
      id={print.id}
      className={cn("collab-print", index % 2 === 1 && "collab-print--reverse")}
      style={{ "--print-tone": print.tone } as CSSProperties}
      aria-labelledby={`${print.id}-title`}
    >
      <div className="brand-shell collab-print__grid">
        <figure className={cn("collab-print__art collab-art", isTall && "collab-print__art--tall")}>
          <div className="collab-print__frame" style={{ aspectRatio: String(print.ratio) }}>
            <AscendImage
              src={print.image}
              alt={print.alt}
              fill
              sizes="(max-width: 900px) 100vw, 58vw"
              className="object-contain"
              priority={index === 0}
            />
          </div>
          <figcaption className="collab-print__caption">
            Print {print.number} / {String(collab.prints.length).padStart(2, "0")} · {collab.title}
          </figcaption>
        </figure>

        <div className="collab-print__copy">
          <p className="collab-print__number" aria-hidden>
            {print.number}
          </p>
          <p className="brand-eyebrow">
            {collab.dropName} · Print {print.number}
          </p>
          <h2 id={`${print.id}-title`} className="collab-print__title">
            {print.title}
          </h2>
          <p className="collab-print__line">{print.line}</p>
          <p className="collab-print__body">{print.body}</p>

          <div className="collab-print__social">
            <p className="collab-print__label">Drops first on</p>
            <SocialLinks />
          </div>

          <nav className="collab-print__pager" aria-label="Prints">
            {prev ? (
              <AnchorLink id={prev.id} onNavigate={onNavigate} className="collab-print__pager-link">
                <span aria-hidden>←</span> {prev.number} {prev.title}
              </AnchorLink>
            ) : (
              <AnchorLink id="collab-top" onNavigate={onNavigate} className="collab-print__pager-link">
                <span aria-hidden>↑</span> The drop
              </AnchorLink>
            )}
            {next ? (
              <AnchorLink id={next.id} onNavigate={onNavigate} className="collab-print__pager-link collab-print__pager-link--next">
                {next.number} {next.title} <span aria-hidden>→</span>
              </AnchorLink>
            ) : (
              <AnchorLink id="instagram" onNavigate={onNavigate} className="collab-print__pager-link collab-print__pager-link--next">
                Follow both pages <span aria-hidden>→</span>
              </AnchorLink>
            )}
          </nav>
        </div>
      </div>
    </section>
  );
}

export function CollabDropPage({ collab }: { collab: Collab }) {
  const scrollToId = useAnchorScroll();
  const printIds = collab.prints.map((p) => p.id);
  const active = useActivePrint(printIds);

  // Keep the active print visible in the horizontally scrolling index on phones.
  useEffect(() => {
    if (!active) return;
    const link = document.querySelector<HTMLElement>(`.collab-index__link[href="#${active}"]`);
    link?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  return (
    <BrandSiteLayout className="page-collab" canvasClassName="collab-canvas">
      {/* ── Hero ── */}
      <header id="collab-top" className="collab-hero">
        <div className="collab-hero__triptych collab-art" aria-hidden>
          {collab.prints.map((print, i) => (
            <div key={print.id} className={cn("collab-hero__panel", `collab-hero__panel--${i + 1}`)}>
              <AscendImage
                src={print.image}
                alt=""
                fill
                priority
                sizes="(max-width: 768px) 60vw, 34vw"
                className="object-cover object-center"
              />
            </div>
          ))}
          <div className="collab-hero__shade" />
        </div>

        <div className="brand-shell collab-hero__copy">
          <p className="brand-eyebrow collab-hero__status">
            <span className="collab-hero__pulse" aria-hidden />
            {collab.status} · {collab.dropName}
          </p>
          <h1 className="collab-hero__title">
            <span>Ascend Theory</span>
            <span className="collab-hero__x" aria-label="cross">×</span>
            <span>NRATLU</span>
          </h1>
          <p className="collab-hero__headline">{collab.headline}</p>
          {collab.statement.map((line) => (
            <p key={line} className="brand-voice collab-hero__statement">
              {line}
            </p>
          ))}

          <div className="collab-hero__actions">
            <AnchorLink id={collab.prints[0]!.id} onNavigate={scrollToId} className="collab-btn collab-btn--primary">
              See the prints <span aria-hidden>↓</span>
            </AnchorLink>
            <a
              href={collab.partner.href}
              target="_blank"
              rel="noopener noreferrer"
              className="collab-btn"
              aria-label={collab.partner.label}
            >
              <InstagramGlyph /> {collab.partner.handle}
            </a>
            <a
              href={collab.house.href}
              target="_blank"
              rel="noopener noreferrer"
              className="collab-btn"
              aria-label={collab.house.label}
            >
              <InstagramGlyph /> {collab.house.handle}
            </a>
          </div>
        </div>
      </header>

      {/* ── Sticky print index — every print one tap away ── */}
      <nav className="collab-index" aria-label="Prints in this drop">
        <div className="brand-shell collab-index__inner">
          <span className="collab-index__label">{collab.dropName}</span>
          <ul className="collab-index__list">
            {collab.prints.map((print) => (
              <li key={print.id}>
                <AnchorLink
                  id={print.id}
                  onNavigate={scrollToId}
                  className={cn("collab-index__link", active === print.id && "is-active")}
                >
                  <span className="collab-index__no">{print.number}</span>
                  <span className="collab-index__name">{print.title}</span>
                </AnchorLink>
              </li>
            ))}
            <li>
              <AnchorLink
                id="instagram"
                onNavigate={scrollToId}
                className="collab-index__link"
                ariaLabel="Instagram pages"
              >
                <InstagramGlyph />
                <span className="collab-index__name">Follow</span>
              </AnchorLink>
            </li>
          </ul>
        </div>
      </nav>

      {collab.prints.map((print, index) => (
        <PrintSection
          key={print.id}
          print={print}
          index={index}
          collab={collab}
          onNavigate={scrollToId}
        />
      ))}

      {/* ── Two pages, one drop ── */}
      <section id="instagram" className="collab-social" aria-labelledby="collab-social-title">
        <div className="brand-shell">
          <p className="brand-eyebrow">Two pages. One drop.</p>
          <h2 id="collab-social-title" className="brand-headline mt-5 max-w-[18ch]">
            The release goes live on Instagram first.
          </h2>
          <p className="brand-voice mt-6">
            Follow both pages to catch the drop the moment it opens.
          </p>
          <SocialLinks variant="cards" className="mt-10" />
        </div>
      </section>

      {/* ── Back into the rest of the house ── */}
      <section className="collab-more" aria-labelledby="collab-more-title">
        <div className="brand-shell">
          <div className="collab-more__head">
            <p className="brand-eyebrow">Earlier drops</p>
            <h2 id="collab-more-title" className="collab-more__title">
              Still in the archive
            </h2>
            <Link href={BRAND_ROUTES.drops} className="collab-more__all">
              All drops <span aria-hidden>→</span>
            </Link>
          </div>
          <ul className="collab-more__grid">
            {DROPS.map((drop) => (
              <li key={drop.slug}>
                <Link href={BRAND_ROUTES.drop(drop.slug)} className="collab-more__card group">
                  <span className="collab-more__thumb ascend-media-wrap">
                    <AscendImage
                      src={drop.image}
                      alt={drop.imageAlt}
                      fill
                      sizes="(max-width: 640px) 50vw, 18rem"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </span>
                  <span className="brand-eyebrow mt-4 block">{drop.dropName}</span>
                  <span className="collab-more__name">{drop.name}</span>
                </Link>
              </li>
            ))}
          </ul>

          <PageExploreLinks excludeHref={BRAND_ROUTES.collab} />
        </div>
      </section>
    </BrandSiteLayout>
  );
}
