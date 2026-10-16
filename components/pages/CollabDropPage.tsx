"use client";

import { AscendImage } from "@/components/AscendImage";
import { BrandSiteLayout } from "@/components/brand/layout/BrandSiteLayout";
import { PageExploreLinks } from "@/components/brand/PageExploreLinks";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { useCinematicScroll } from "@/contexts/cinematic-scroll";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import type { Collab, CollabPrint } from "@/lib/data/collabs";
import { DROPS } from "@/lib/data/drops";
import { cn } from "@/lib/utils";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

/* Same timing as the homepage portal. */
const SUBTEXT_DELAY_MS = 800;
const HIDE_TEXT_DELAY_MS = 2500;
const DIRECTIONS_DELAY_MS = 3000;
const ENTRY_STAGGER_S = 0.2;
const EASE = [0.33, 1, 0.68, 1] as const;

function subscribeReduce(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useReduceMotion() {
  return useSyncExternalStore(
    subscribeReduce,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Smooth scroll to a section (Lenis when running), keeping the URL hash in sync. */
function useSectionScroll() {
  const { lenis } = useCinematicScroll();

  const scrollToId = useCallback(
    (id: string, smooth = true) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (smooth) window.history.replaceState(null, "", `#${id}`);
      if (lenis) {
        lenis.scrollTo(el, { offset: 0, duration: 1.6, immediate: !smooth });
      } else {
        const top = el.getBoundingClientRect().top + window.scrollY;
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

function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
        let best: string | null = null;
        let bestRatio = 0;
        visible.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            best = id;
            bestRatio = ratio;
          }
        });
        setActive(bestRatio > 0 ? best : null);
      },
      { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

/* ─────────────────────────────── Opening ─────────────────────────────── */

function PortalVideo({ collab, reduce }: { collab: Collab; reduce: boolean }) {
  const [mobileReady, setMobileReady] = useState(false);
  const [desktopReady, setDesktopReady] = useState(false);
  const v = collab.video;

  return (
    <div className="collab-portal__media" aria-hidden>
      <picture>
        <source media="(min-width: 768px)" srcSet={v.desktopPoster} />
        <img src={v.mobilePoster} alt="" fetchPriority="high" />
      </picture>
      {!reduce ? (
        <>
          <video
            className={cn("md:hidden", mobileReady && "is-ready")}
            src={v.mobile}
            poster={v.mobilePoster}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onLoadedData={() => setMobileReady(true)}
          />
          <video
            className={cn("hidden md:block", desktopReady && "is-ready")}
            src={v.desktop}
            poster={v.desktopPoster}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onLoadedData={() => setDesktopReady(true)}
          />
        </>
      ) : null}
      <div className="portal-editorial-grain" />
    </div>
  );
}

function CollabPortal({
  collab,
  onEnter,
}: {
  collab: Collab;
  onEnter: (id: string) => void;
}) {
  const reduce = useReduceMotion();
  const [showSub, setShowSub] = useState(false);
  const [hideIntro, setHideIntro] = useState(false);
  const [showDirections, setShowDirections] = useState(false);

  useEffect(() => {
    const t1 = window.setTimeout(() => setShowSub(true), reduce ? 0 : SUBTEXT_DELAY_MS);
    const t2 = window.setTimeout(() => setHideIntro(true), reduce ? 0 : HIDE_TEXT_DELAY_MS);
    const t3 = window.setTimeout(() => setShowDirections(true), reduce ? 0 : DIRECTIONS_DELAY_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [reduce]);

  const count = collab.prints.length;

  return (
    <header id="collab-top" className="collab-portal" aria-label={collab.title}>
      <PortalVideo collab={collab} reduce={reduce} />
      <div className="collab-portal__shade" aria-hidden />

      <div
        className={cn("collab-portal__intro", hideIntro && showDirections && "is-out")}
        aria-hidden={hideIntro && showDirections}
      >
        <h1 className="collab-portal__title">
          Ascend Theory
          <span className="collab-portal__title-x" aria-label="cross">
            ×
          </span>
          <br className="md:hidden" />
          NRATLU
        </h1>
        <p className={cn("collab-portal__sub", showSub && "is-in")}>
          {collab.status} · {collab.headline}
        </p>
      </div>

      <nav
        className={cn("collab-portal__directions", showDirections && "is-on")}
        aria-label="The three prints"
        aria-hidden={!showDirections}
      >
        <p className="collab-portal__kicker">
          Ascend Theory <b>×</b> NRATLU · {collab.dropName}
        </p>
        <ol className="collab-portal__list">
          {collab.prints.map((print, i) => (
            <li key={print.id}>
              <button
                type="button"
                className="collab-portal__entry"
                style={{ animationDelay: `${((count - i) * ENTRY_STAGGER_S).toFixed(1)}s` }}
                disabled={!showDirections}
                onClick={() => onEnter(print.id)}
              >
                <span className="collab-portal__entry-no">{print.number}</span>
                {print.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div
        className={cn("collab-portal__social", showDirections && "is-on")}
        aria-hidden={!showDirections}
      >
        <SocialLinks />
      </div>

      <button
        type="button"
        className={cn("collab-portal__cue", showDirections && "is-on")}
        onClick={() => onEnter(collab.prints[0]!.id)}
        aria-hidden={!showDirections}
        tabIndex={showDirections ? 0 : -1}
      >
        Scroll
        <span className="collab-portal__cue-line" aria-hidden />
      </button>
    </header>
  );
}

/* ─────────────────────────────── Prints ─────────────────────────────── */

const copyContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } },
};

const copyItem: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

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
  const reduce = useReducedMotion();
  const next = collab.prints[index + 1];
  const total = String(collab.prints.length).padStart(2, "0");
  const tall = print.ratio < 0.8;
  const motionProps = reduce
    ? {}
    : {
        initial: "hidden" as const,
        whileInView: "visible" as const,
        viewport: { once: true, amount: 0.35 },
      };

  return (
    <section
      id={print.id}
      className={cn(
        "collab-print",
        index % 2 === 1 && "collab-print--reverse",
        tall && "collab-print--tall",
      )}
      style={
        {
          "--print-tone": print.tone,
          "--print-ratio": print.ratio.toFixed(4),
        } as CSSProperties
      }
      aria-labelledby={`${print.id}-title`}
    >
      <div className="collab-print__fill" aria-hidden>
        <AscendImage src={print.image} alt="" fill sizes="40vw" className="object-cover" />
      </div>

      <div className="brand-shell collab-print__grid">
        <motion.figure
          className="collab-print__art collab-art"
          {...(reduce
            ? {}
            : {
                initial: { opacity: 0, scale: 0.96 },
                whileInView: { opacity: 1, scale: 1 },
                viewport: { once: true, amount: 0.3 },
                transition: { duration: 1.1, ease: EASE },
              })}
        >
          <div className="collab-print__frame">
            <AscendImage
              src={print.image}
              alt={print.alt}
              fill
              sizes="(max-width: 899px) 100vw, 56vw"
              className="object-contain"
              priority={index === 0}
            />
          </div>
          <figcaption className="collab-print__caption">
            Print {print.number} / {total} · {collab.title}
          </figcaption>
        </motion.figure>

        <motion.div className="collab-print__copy" variants={copyContainer} {...motionProps}>
          <motion.p variants={copyItem} className="collab-print__eyebrow">
            <b>{print.number}</b> Print {print.number} / {total} · {print.pillar}
          </motion.p>
          <motion.h2 variants={copyItem} id={`${print.id}-title`} className="collab-print__title">
            {print.title}
          </motion.h2>
          <motion.h3 variants={copyItem} className="collab-print__standard">
            {print.standard}
          </motion.h3>
          <motion.p variants={copyItem} className="collab-print__body">
            {print.body[0]}{" "}
            <span className="collab-print__body-more">{print.body.slice(1).join(" ")}</span>
          </motion.p>
          <motion.blockquote variants={copyItem} className="collab-print__quote">
            “{print.quote}”
            <cite>{print.journal.kicker} · {print.journal.label}</cite>
          </motion.blockquote>

          <motion.div variants={copyItem} className="collab-print__reads">
            <Link href={print.journal.href} className="collab-read">
              <span className="collab-read__kicker">{print.journal.kicker}</span>
              <span className="collab-read__label">{print.journal.label}</span>
              <span className="collab-read__more">
                Read more <span aria-hidden>→</span>
              </span>
            </Link>
            <Link href={print.philosophy.href} className="collab-read">
              <span className="collab-read__kicker">{print.philosophy.kicker}</span>
              <span className="collab-read__label">The {print.philosophy.label} standard</span>
              <span className="collab-read__more">
                Read more <span aria-hidden>→</span>
              </span>
            </Link>
          </motion.div>

          <motion.div variants={copyItem} className="collab-print__foot">
            <SocialLinks />
            <button
              type="button"
              className="collab-print__next"
              onClick={() => onNavigate(next ? next.id : "instagram")}
            >
              {next ? `${next.number} ${next.title}` : "Follow the drop"}
              <span aria-hidden>↓</span>
            </button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function PrintRail({
  collab,
  active,
  onNavigate,
}: {
  collab: Collab;
  active: string | null;
  onNavigate: (id: string) => void;
}) {
  const on = collab.prints.some((p) => p.id === active);
  return (
    <nav className={cn("collab-rail", on && "is-on")} aria-label="Prints" aria-hidden={!on}>
      {collab.prints.map((print) => (
        <button
          key={print.id}
          type="button"
          tabIndex={on ? 0 : -1}
          className={cn("collab-rail__link", active === print.id && "is-active")}
          onClick={() => onNavigate(print.id)}
          aria-label={`Print ${print.number}: ${print.title}`}
          aria-current={active === print.id ? "true" : undefined}
        >
          <span className="collab-rail__no">{print.number}</span>
          <span className="collab-rail__tick" />
        </button>
      ))}
    </nav>
  );
}

/* ─────────────────────────────── Page ─────────────────────────────── */

export function CollabDropPage({ collab }: { collab: Collab }) {
  const scrollToId = useSectionScroll();
  const [ids] = useState(() => collab.prints.map((p) => p.id));
  const active = useActiveSection(ids);

  return (
    <BrandSiteLayout className="page-collab" canvasClassName="collab-canvas">
      <CollabPortal collab={collab} onEnter={scrollToId} />

      {collab.prints.map((print, index) => (
        <PrintSection
          key={print.id}
          print={print}
          index={index}
          collab={collab}
          onNavigate={scrollToId}
        />
      ))}

      <PrintRail collab={collab} active={active} onNavigate={scrollToId} />

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
