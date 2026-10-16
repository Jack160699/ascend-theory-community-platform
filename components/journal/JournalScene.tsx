"use client";

import { AscendImage } from "@/components/AscendImage";
import { JournalReveal } from "@/components/journal/JournalReveal";
import type { JournalScene as JournalSceneData } from "@/lib/data/journal";
import type { JournalMotion } from "@/lib/data/journal-themes";
import { getDropBySlug } from "@/lib/data/drops";
import { JOURNAL_AUTHOR_SOCIAL } from "@/lib/data/journal-author";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import {
  JOURNAL_DURATION,
  JOURNAL_DURATION_SLOW,
  JOURNAL_EASE,
  JOURNAL_RISE_SUBTLE,
  JOURNAL_STAGGER,
} from "@/lib/motion/journal-motion";
import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { useEffect, useRef } from "react";

/** Pure black before intro copy (300–400ms) */
const INTRO_VOID_S = 0.38;

/** Outro rhythm — ~1s beat after first line, longer pause before second outro line */
const OUTRO_T = {
  firstClose: 0.42,
  afterCloseBeat: 1.35,
  /** Delay from first outro line start to second (“build differently.”) */
  secondOutroDelay: 1.38,
  beforeSub: 0.72,
  beforeCta: 1.12,
  beforeMark: 0.62,
} as const;

const SCROLL_HINT_DELAY_S = INTRO_VOID_S + 1.68;

type JournalSceneProps = {
  scene: JournalSceneData;
  index: number;
  /** The issue's scroll signature — ride (Discipline), rise (Silence), unmask (Presence). */
  motionStyle?: JournalMotion;
};

/** Statement reveal, shaped by the issue's motion. */
function ThemedStatement({
  text,
  motionStyle,
  peak,
  className,
}: {
  text: string;
  motionStyle?: JournalMotion;
  peak?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce || !motionStyle) {
    return (
      <JournalReveal y={peak ? 52 : 40} duration={peak ? 1.35 : JOURNAL_DURATION_SLOW} delay={peak ? 0.22 : 0.08}>
        <h2 className={className}>{text}</h2>
      </JournalReveal>
    );
  }

  if (motionStyle === "ride") {
    // Word by word, left to right — a held gait.
    const words = text.split(" ");
    return (
      <motion.h2
        className={cn(className, "journal-statement--ride")}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.4 }}
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.11, delayChildren: 0.1 } } }}
        aria-label={text}
      >
        {words.map((w, i) => (
          <motion.span
            key={`${w}-${i}`}
            aria-hidden
            className="journal-statement__word"
            variants={{
              hidden: { opacity: 0, x: -36 },
              visible: { opacity: 1, x: 0, transition: { duration: 0.75, ease: JOURNAL_EASE } },
            }}
          >
            {w}{" "}
          </motion.span>
        ))}
      </motion.h2>
    );
  }

  if (motionStyle === "rise") {
    // Rises out of a mask, like a figure cresting a hill.
    return (
      // Observe the mask, not the clipped heading — a fully clipped target never intersects.
      <motion.div
        className="journal-statement__mask"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
      >
        <motion.h2
          className={cn(className, "journal-statement--rise")}
          variants={{
            hidden: { y: "105%" },
            visible: { y: "0%", transition: { duration: 1.5, ease: JOURNAL_EASE, delay: 0.1 } },
          }}
        >
          {text}
        </motion.h2>
      </motion.div>
    );
  }

  // unmask — out of blur into focus.
  return (
    <motion.h2
      className={cn(className, "journal-statement--unmask")}
      initial={{ opacity: 0, filter: "blur(18px)", letterSpacing: "0.04em" }}
      whileInView={{ opacity: 1, filter: "blur(0px)", letterSpacing: "-0.03em" }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 1.6, ease: JOURNAL_EASE, delay: 0.1 }}
    >
      {text}
    </motion.h2>
  );
}

export function JournalScene({ scene, index, motionStyle }: JournalSceneProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const fgParallaxRef = useRef<HTMLDivElement>(null);
  const captionParallaxRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || scene.type !== "visual") return;
    const el = mediaRef.current;
    const trigger = sectionRef.current;
    if (!el || !trigger) return;

    gsap.registerPlugin(ScrollTrigger);
    const inner = el.querySelector(".journal-scene__media-inner");
    const fg = fgParallaxRef.current;
    const caption = captionParallaxRef.current;
    if (!inner) return;

    const isPeak = Boolean(scene.peak);
    const themed: Record<JournalMotion, { from: gsap.TweenVars; to: gsap.TweenVars }> = {
      ride: { from: { scale: 1.18, xPercent: -6, y: 0 }, to: { scale: 1.06, xPercent: 6, y: 0 } },
      rise: { from: { scale: 1.32, y: 100 }, to: { scale: 1.08, y: -20 } },
      unmask: {
        from: { scale: 1.12, y: 0, clipPath: "inset(16% 34% 16% 34%)" },
        to: { scale: 1, y: 0, clipPath: "inset(0% 0% 0% 0%)" },
      },
    };
    const bgFrom = motionStyle ? themed[motionStyle].from : isPeak ? { scale: 1.26, y: 80 } : { scale: 1.2, y: 62 };
    const bgTo = motionStyle ? themed[motionStyle].to : isPeak ? { scale: 1, y: -32 } : { scale: 1, y: -24 };
    const scrubBg = isPeak ? 2.75 : 2.55;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        inner,
        bgFrom,
        {
          ...bgTo,
          ease: "none",
          scrollTrigger: {
            trigger,
            start: "top bottom",
            end: "bottom top",
            scrub: scrubBg,
          },
        },
      );

      if (fg) {
        gsap.fromTo(
          fg,
          { y: isPeak ? 52 : 40 },
          {
            y: isPeak ? -72 : -58,
            ease: "none",
            scrollTrigger: {
              trigger,
              start: "top bottom",
              end: "bottom top",
              scrub: isPeak ? 0.82 : 0.92,
            },
          },
        );
      }

      if (caption) {
        gsap.fromTo(
          caption,
          { y: 72 },
          {
            y: -64,
            ease: "none",
            scrollTrigger: {
              trigger,
              start: "top bottom",
              end: "bottom top",
              scrub: 0.28,
            },
          },
        );
      }
    }, el);

    return () => ctx.revert();
  }, [reduce, scene.peak, scene.type, motionStyle]);

  useEffect(() => {
    if (reduce || scene.type !== "media") return;
    const section = sectionRef.current;
    const sticky = stickyRef.current;
    if (!section || !sticky) return;

    gsap.registerPlugin(ScrollTrigger);
    const inner = sticky.querySelector(".journal-scene__media-inner");
    const fg = fgParallaxRef.current;
    if (!inner) return;

    const isPeak = Boolean(scene.peak);
    const endScale = isPeak ? 1.24 : 1.14;
    const mediaThemed: Record<JournalMotion, { from: gsap.TweenVars; to: gsap.TweenVars }> = {
      ride: { from: { scale: 1.12, xPercent: -4 }, to: { scale: 1.2, xPercent: 4 } },
      rise: { from: { scale: 1.28, yPercent: 6 }, to: { scale: 1.02, yPercent: -2 } },
      unmask: {
        from: { scale: 1.04, filter: "saturate(0) brightness(0.55)" },
        to: { scale: 1.16, filter: "saturate(1.05) brightness(1)" },
      },
    };
    const mFrom = motionStyle ? mediaThemed[motionStyle].from : { scale: 1.02 };
    const mTo = motionStyle ? mediaThemed[motionStyle].to : { scale: endScale };

    const ctx = gsap.context(() => {
      gsap.fromTo(
        inner,
        mFrom,
        {
          ...mTo,
          ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top top",
            end: "bottom bottom",
            scrub: isPeak ? 1.88 : 1.78,
          },
        },
      );

      if (fg) {
        gsap.fromTo(
          fg,
          { y: isPeak ? 32 : 22 },
          {
            y: isPeak ? -44 : -34,
            ease: "none",
            scrollTrigger: {
              trigger: section,
              start: "top top",
              end: "bottom bottom",
              scrub: isPeak ? 0.78 : 0.88,
            },
          },
        );
      }
    }, section);

    return () => ctx.revert();
  }, [reduce, scene.peak, scene.type, motionStyle]);

  // Artwork scene — the print enters in the issue's motion.
  useEffect(() => {
    if (reduce || scene.type !== "artwork") return;
    const section = sectionRef.current;
    const frame = mediaRef.current;
    if (!section || !frame) return;
    gsap.registerPlugin(ScrollTrigger);
    const from: Record<JournalMotion, gsap.TweenVars> = {
      ride: { xPercent: -14, opacity: 0.2 },
      rise: { yPercent: 22, opacity: 0.2 },
      unmask: { clipPath: "inset(0% 50% 0% 50%)", opacity: 1 },
    };
    const to: Record<JournalMotion, gsap.TweenVars> = {
      ride: { xPercent: 0, opacity: 1 },
      rise: { yPercent: 0, opacity: 1 },
      unmask: { clipPath: "inset(0% 0% 0% 0%)", opacity: 1 },
    };
    const key = motionStyle ?? "rise";
    const ctx = gsap.context(() => {
      gsap.fromTo(frame, from[key], {
        ...to[key],
        ease: "none",
        scrollTrigger: { trigger: section, start: "top 85%", end: "center 55%", scrub: 1.2 },
      });
    }, section);
    return () => ctx.revert();
  }, [reduce, scene.type, motionStyle]);

  useEffect(() => {
    if (reduce) return;
    if (scene.type !== "typography") return;
    const section = sectionRef.current;
    if (!section) return;

    gsap.registerPlugin(ScrollTrigger);
    const pinStretch = () =>
      typeof window !== "undefined" && window.innerWidth <= 768 ? 0.62 : 1.28;
    const st = ScrollTrigger.create({
      trigger: section,
      start: "top top",
      end: () => `+=${Math.round(window.innerHeight * pinStretch())}`,
      pin: true,
      pinSpacing: true,
      anticipatePin: 1,
    });

    return () => st.kill();
  }, [reduce, scene.type, scene.id]);

  switch (scene.type) {
    case "intro":
      return (
        <section
          ref={sectionRef}
          className="journal-scene journal-scene--intro journal-scene--hero-entry"
          data-scene={scene.id}
        >
          <motion.div
            className="journal-scene__intro-bg-wrap"
            initial={reduce ? false : { scale: 1.05, opacity: 0.92 }}
            animate={reduce ? undefined : { scale: 1, opacity: 1 }}
            transition={{ duration: 1.1, ease: JOURNAL_EASE }}
            aria-hidden
          >
            <div className="journal-scene__intro-bg journal-scene__intro-bg--drift" />
            {scene.image ? (
              <motion.div
                className={cn("journal-scene__intro-art", motionStyle && `journal-scene__intro-art--${motionStyle}`)}
                initial={
                  reduce
                    ? false
                    : motionStyle === "unmask"
                      ? { clipPath: "inset(0% 50% 0% 50%)" }
                      : { opacity: 0 }
                }
                animate={reduce ? undefined : motionStyle === "unmask" ? { clipPath: "inset(0% 0% 0% 0%)" } : { opacity: 1 }}
                transition={{ duration: 2.2, ease: JOURNAL_EASE, delay: 0.2 }}
              >
                <AscendImage
                  src={scene.image}
                  alt=""
                  fill
                  priority
                  sizes="100vw"
                  className="object-cover"
                />
              </motion.div>
            ) : null}
          </motion.div>
          <div className="journal-scene__intro-bottom-fade" aria-hidden />
          <div className="journal-scene__grain journal-scene__grain--drift" aria-hidden />
          <div className="journal-scene__inner journal-scene__intro-content">
            {scene.kicker ? (
              <JournalReveal
                onMount
                delay={INTRO_VOID_S + 0.55}
                y={JOURNAL_RISE_SUBTLE}
                duration={0.95}
              >
                <p className="journal-scene__kicker">{scene.kicker}</p>
              </JournalReveal>
            ) : null}
            <h1 className="journal-scene__intro-lines">
              {scene.lines?.map((line, i) => (
                <JournalReveal
                  key={line}
                  onMount
                  delay={INTRO_VOID_S + 0.72 + i * 0.28}
                  y={36}
                  duration={JOURNAL_DURATION_SLOW}
                  className={cn(
                    "journal-scene__intro-line block",
                    i === 1 && "journal-scene__intro-line--secondary",
                  )}
                >
                  <span>{line}</span>
                </JournalReveal>
              ))}
            </h1>
            <JournalReveal
              onMount
              delay={SCROLL_HINT_DELAY_S}
              y={12}
              duration={0.85}
            >
              <p
                className="journal-scene__scroll-hint journal-scene__scroll-hint--arrow"
                aria-hidden
              >
                ↓ SCROLL
              </p>
            </JournalReveal>
          </div>
        </section>
      );

    case "visual":
      return (
        <section
          ref={sectionRef}
          className="journal-scene journal-scene--visual"
          data-scene={scene.id}
        >
          <div ref={mediaRef} className="journal-scene__media journal-scene__media--full">
            <div className="journal-scene__media-inner">
              {scene.image ? (
                <AscendImage
                  src={scene.image}
                  alt={scene.imageAlt ?? ""}
                  fill
                  priority={index < 2}
                  loading={index >= 2 ? "lazy" : undefined}
                  sizes="100vw"
                  className="object-cover object-center"
                />
              ) : null}
            </div>
            <div ref={fgParallaxRef} className="journal-scene__parallax-fg">
              <div className="journal-scene__edge-blur journal-scene__edge-blur--top" aria-hidden />
              <div className="journal-scene__edge-blur journal-scene__edge-blur--bottom" aria-hidden />
              <div className="journal-scene__vignette" aria-hidden />
              <div className="journal-scene__visual-gradient" aria-hidden />
            </div>
          </div>
          {scene.caption ? (
            <div ref={captionParallaxRef} className="journal-scene__caption-outer">
              <JournalReveal className="journal-scene__caption-wrap" y={24} delay={0.12}>
                <h2 className="journal-scene__caption">{scene.caption}</h2>
              </JournalReveal>
            </div>
          ) : null}
        </section>
      );

    case "typography":
      return (
        <section
          ref={sectionRef}
          className={cn(
            "journal-scene journal-scene--typography",
            index % 2 === 0 ? "journal-scene--align-left" : "journal-scene--align-right",
            scene.peak && "journal-scene--typography-peak",
          )}
          data-scene={scene.id}
        >
          <ThemedStatement
            text={scene.statement ?? ""}
            motionStyle={motionStyle}
            peak={scene.peak}
            className="journal-scene__statement"
          />
        </section>
      );

    case "artwork":
      return (
        <section
          ref={sectionRef}
          className={cn("journal-scene journal-scene--artwork", motionStyle && `journal-scene--artwork-${motionStyle}`)}
          data-scene={scene.id}
        >
          <div className="journal-artwork">
            <div className="journal-artwork__copy">
              {scene.kicker ? <p className="journal-scene__kicker">{scene.kicker}</p> : null}
              {scene.statement ? <h2 className="journal-artwork__title">{scene.statement}</h2> : null}
              {scene.caption ? <p className="journal-artwork__caption">{scene.caption}</p> : null}
            </div>
            <div
              ref={mediaRef}
              className="journal-artwork__frame"
              style={{ aspectRatio: String(scene.ratio ?? 1) }}
            >
              {scene.image ? (
                <AscendImage
                  src={scene.image}
                  alt={scene.imageAlt ?? ""}
                  fill
                  sizes="(max-width: 768px) 100vw, 60vw"
                  className="object-contain"
                />
              ) : null}
            </div>
          </div>
        </section>
      );

    case "shop": {
      const product = scene.productSlug ? getDropBySlug(scene.productSlug) : undefined;
      if (!product) return null;
      return (
        <section
          ref={sectionRef}
          className="journal-scene journal-scene--shop"
          data-scene={scene.id}
        >
          <div className="journal-shop">
            <JournalReveal className="journal-shop__worn" y={36} duration={1.1}>
              <Link href={BRAND_ROUTES.drop(product.slug)} className="journal-shop__worn-link" aria-label={`Shop the ${product.name}`}>
                {scene.image ? (
                  <AscendImage
                    src={scene.image}
                    alt={scene.imageAlt ?? ""}
                    fill
                    sizes="(max-width: 768px) 100vw, 45vw"
                    className="object-cover"
                  />
                ) : null}
              </Link>
            </JournalReveal>
            <div className="journal-shop__copy">
              <JournalReveal y={20} delay={0.1}>
                {scene.kicker ? <p className="journal-scene__kicker">{scene.kicker}</p> : null}
                <h2 className="journal-shop__title">{product.name}</h2>
                {scene.caption ? <p className="journal-shop__line">{scene.caption}</p> : null}
              </JournalReveal>
              <JournalReveal y={16} delay={0.25}>
                <div className="journal-shop__row">
                  {scene.printImage ? (
                    <span className="journal-shop__print" style={{ aspectRatio: String(scene.ratio ?? 1) }}>
                      <AscendImage src={scene.printImage} alt={scene.printAlt ?? ""} fill sizes="120px" className="object-contain" />
                    </span>
                  ) : null}
                  <div>
                    <p className="journal-shop__price">{product.price.display}</p>
                    <p className="journal-shop__meta">Oversized black tee · S–XXL</p>
                  </div>
                </div>
                <div className="journal-shop__actions">
                  <Link href={BRAND_ROUTES.drop(product.slug)} className="journal-shop__buy">
                    Shop the tee · {product.price.display}
                  </Link>
                  <Link href={BRAND_ROUTES.collab} className="journal-shop__collab">
                    The full drop <span aria-hidden>→</span>
                  </Link>
                </div>
              </JournalReveal>
            </div>
          </div>
        </section>
      );
    }

    case "text":
      return (
        <section
          ref={sectionRef}
          className={cn(
            "journal-scene journal-scene--text",
            "journal-scene--align-right",
          )}
          data-scene={scene.id}
        >
          <div className="journal-scene__inner journal-scene__inner--narrow journal-scene__inner--offset">
            {scene.kicker ? (
              <h2 className="journal-scene__kicker journal-scene__section-heading">
                {scene.kicker}
              </h2>
            ) : null}
            <motion.div
              initial={reduce ? false : "hidden"}
              whileInView={reduce ? undefined : "visible"}
              viewport={{ once: true, amount: 0.45 }}
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: JOURNAL_STAGGER } },
              }}
            >
              {scene.body?.map((line, lineIndex) => (
                <motion.p
                  key={line}
                  className={cn(
                    "journal-scene__body-line",
                    lineIndex % 2 === 1 && "journal-scene__body-line--shift",
                  )}
                  variants={{
                    hidden: { opacity: 0, y: JOURNAL_RISE_SUBTLE },
                    visible: {
                      opacity: 1,
                      y: 0,
                      transition: { duration: JOURNAL_DURATION, ease: JOURNAL_EASE },
                    },
                  }}
                >
                  {line}
                </motion.p>
              ))}
            </motion.div>
          </div>
        </section>
      );

    case "media":
      return (
        <section
          ref={sectionRef}
          className={cn(
            "journal-scene journal-scene--media",
            scene.peak && "journal-scene--media-peak",
          )}
          data-scene={scene.id}
        >
          <div ref={stickyRef} className="journal-scene__media journal-scene__media--sticky">
            <div className="journal-scene__media-inner-wrap">
              <div className="journal-scene__media-inner">
                {scene.image ? (
                  <AscendImage
                    src={scene.image}
                    alt={scene.imageAlt ?? ""}
                    fill
                    priority={false}
                    loading={index >= 2 ? "lazy" : "eager"}
                    sizes="100vw"
                    className="object-cover object-center journal-scene__media-dim"
                  />
                ) : null}
              </div>
              <div
                ref={fgParallaxRef}
                className="journal-scene__parallax-fg journal-scene__parallax-fg--media"
              >
                <div className="journal-scene__edge-blur journal-scene__edge-blur--top" aria-hidden />
                <div className="journal-scene__media-overlay" aria-hidden />
                <div className="journal-scene__visual-gradient" aria-hidden />
              </div>
            </div>
          </div>
          <div className="journal-scene__media-copy">
            {scene.statement ? (
              <JournalReveal
                y={scene.peak ? 40 : 32}
                duration={JOURNAL_DURATION_SLOW}
                delay={scene.peak ? 0.72 : 0.45}
              >
                <h2 className="journal-scene__statement journal-scene__statement--overlay">
                  {scene.statement}
                </h2>
              </JournalReveal>
            ) : null}
          </div>
        </section>
      );

    case "byline":
      return (
        <section
          ref={sectionRef}
          className="journal-scene journal-scene--byline"
          data-scene={scene.id}
        >
          <div className="journal-scene__byline">
            <p className="journal-scene__byline-label">Written by</p>
            <p className="journal-scene__byline-name">Ascend Theory</p>
            {scene.publishedDisplay ? (
              <p className="journal-scene__byline-date">{scene.publishedDisplay}</p>
            ) : null}
          </div>
        </section>
      );

    case "signature":
      return (
        <section
          ref={sectionRef}
          className="journal-scene journal-scene--signature"
          data-scene={scene.id}
        >
          <div className="journal-scene__signature-card">
            <div className="journal-scene__signature-avatar">
              <AscendImage
                src={JOURNAL_AUTHOR_SOCIAL.avatarSrc}
                alt="Ascend Theory"
                width={52}
                height={52}
                sizes="52px"
                className="journal-scene__signature-avatar-img"
              />
            </div>
            <div className="journal-scene__signature-copy">
              <p className="journal-scene__signature-name">
                {JOURNAL_AUTHOR_SOCIAL.displayName}
              </p>
              <p className="journal-scene__signature-handles">
                <a
                  href={JOURNAL_AUTHOR_SOCIAL.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="journal-scene__signature-link"
                >
                  {JOURNAL_AUTHOR_SOCIAL.handle}
                </a>
                <span className="journal-scene__signature-sep" aria-hidden>
                  ·
                </span>
                <a
                  href={JOURNAL_AUTHOR_SOCIAL.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="journal-scene__signature-link"
                >
                  WhatsApp
                </a>
              </p>
              <p className="journal-scene__signature-tagline">
                {JOURNAL_AUTHOR_SOCIAL.tagline}
              </p>
            </div>
          </div>
        </section>
      );

    case "outro": {
      const closingParts =
        scene.closingLines?.length ? scene.closingLines : scene.closing ? [scene.closing] : [];
      const outroParts =
        scene.outroLineParts?.length ? scene.outroLineParts : scene.outroLine ? [scene.outroLine] : [];

      const tOutroFirst = OUTRO_T.firstClose + OUTRO_T.afterCloseBeat;
      const tOutroSecond = tOutroFirst + OUTRO_T.secondOutroDelay;
      const tSub = tOutroSecond + OUTRO_T.beforeSub;
      const tCta = tSub + OUTRO_T.beforeCta;
      const tMark = tCta + OUTRO_T.beforeMark;

      return (
        <section
          ref={sectionRef}
          className="journal-scene journal-scene--outro"
          data-scene={scene.id}
        >
          <div className="journal-scene__outro-fade journal-scene__outro-fade--deep" aria-hidden />
          <div
            className="journal-scene__grain journal-scene__grain--heavy journal-scene__grain--drift"
            aria-hidden
          />
          <div className="journal-scene__outro-inner">
            {closingParts.map((line, i) => (
              <JournalReveal
                key={line}
                y={28}
                duration={JOURNAL_DURATION_SLOW}
                delay={OUTRO_T.firstClose + i * 0.32}
              >
                <p className={cn("journal-scene__closing", i > 0 && "journal-scene__closing--second")}>
                  {line}
                </p>
              </JournalReveal>
            ))}
            {outroParts.map((line, i) => (
              <JournalReveal
                key={line}
                y={22}
                duration={1.05}
                delay={
                  tOutroFirst +
                  (i === 0 ? 0 : OUTRO_T.secondOutroDelay + (i - 1) * 0.28)
                }
              >
                <p className={cn("journal-scene__outro-line", i > 0 && "journal-scene__outro-line--second")}>
                  {line}
                </p>
              </JournalReveal>
            ))}
            {scene.subclosing ? (
              <JournalReveal y={16} duration={0.95} delay={tSub}>
                <p className="journal-scene__subclosing">{scene.subclosing}</p>
              </JournalReveal>
            ) : null}
            {scene.ctaLabel ? (
              <JournalReveal y={12} duration={0.9} delay={tCta}>
                <Link href={BRAND_ROUTES.journal} className="journal-scene__outro-cta">
                  {scene.ctaLabel}
                </Link>
              </JournalReveal>
            ) : null}
            <JournalReveal y={8} duration={0.85} delay={tMark}>
              <p className="journal-scene__outro-mark">Ascend Theory</p>
            </JournalReveal>
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}
