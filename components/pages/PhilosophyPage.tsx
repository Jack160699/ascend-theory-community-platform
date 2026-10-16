"use client";

import { BrandSiteLayout } from "@/components/brand/layout/BrandSiteLayout";
import { PhilosophyReveal } from "@/components/philosophy/PhilosophyReveal";
import { NextDropBanner } from "@/components/brand/NextDropBanner";
import { PageExploreLinks } from "@/components/brand/PageExploreLinks";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import { useAssessmentModal } from "@/contexts/assessment-modal";
import { PHILOSOPHY_PAGE } from "@/lib/brand/content";
import {
  PHILOSOPHY_AUTHORITY_PAUSE,
  PHILOSOPHY_CTA_DELAY,
  PHILOSOPHY_DURATION,
  PHILOSOPHY_DURATION_SLOW,
  PHILOSOPHY_EASE,
  PHILOSOPHY_HERO_ECHO_DELAY,
  PHILOSOPHY_RISE_HERO,
  PHILOSOPHY_RISE_LINE,
  PHILOSOPHY_RISE_PILLAR,
  PHILOSOPHY_STAGGER_LINE,
  PHILOSOPHY_VIEWPORT,
  PHILOSOPHY_VIEWPORT_CTA,
  PHILOSOPHY_VIEWPORT_DEEP,
} from "@/lib/motion/philosophy-motion";
import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "framer-motion";

const tensionContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: PHILOSOPHY_STAGGER_LINE },
  },
};

const tensionItem = {
  hidden: { opacity: 0, y: PHILOSOPHY_RISE_LINE },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: PHILOSOPHY_DURATION, ease: PHILOSOPHY_EASE },
  },
};

const authorityContainer = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: PHILOSOPHY_AUTHORITY_PAUSE,
      staggerChildren: 0.15,
    },
  },
};

const authorityItem = {
  hidden: { opacity: 0, y: PHILOSOPHY_RISE_LINE },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: PHILOSOPHY_DURATION_SLOW, ease: PHILOSOPHY_EASE },
  },
};

const pillarContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.22 },
  },
};

const pillarItem01 = {
  hidden: { opacity: 0, y: PHILOSOPHY_RISE_PILLAR },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: PHILOSOPHY_DURATION, ease: PHILOSOPHY_EASE },
  },
};

const pillarItem02 = {
  hidden: { opacity: 0, y: PHILOSOPHY_RISE_PILLAR },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: PHILOSOPHY_DURATION, ease: PHILOSOPHY_EASE },
  },
};

const pillarItem03 = {
  hidden: { opacity: 0, y: PHILOSOPHY_RISE_PILLAR },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: PHILOSOPHY_DURATION_SLOW, ease: PHILOSOPHY_EASE },
  },
};

const filterContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: PHILOSOPHY_STAGGER_LINE },
  },
};

const filterItem = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: PHILOSOPHY_DURATION, ease: PHILOSOPHY_EASE },
  },
};

const pillarVariantsByIndex: Record<string, typeof pillarItem01> = {
  "01": pillarItem01,
  "02": pillarItem02,
  "03": pillarItem03,
};

export function PhilosophyPage() {
  const { openAssessment } = useAssessmentModal();
  const copy = PHILOSOPHY_PAGE;
  const reduce = useReducedMotion();

  const staticVisible = reduce
    ? { opacity: 1, y: 0, scale: 1 }
    : undefined;

  return (
    <BrandSiteLayout className="page-philosophy">
      <article className="philosophy-page">
        <header className="brand-shell philosophy-page__hook">
          <PhilosophyReveal onMount delay={0} duration={0.85} y={12}>
            <p className="brand-eyebrow">{copy.eyebrow}</p>
          </PhilosophyReveal>
          <h1 className="philosophy-page__hook-title mt-6">
            <PhilosophyReveal
              as={motion.span}
              onMount
              className="philosophy-page__hook-line block"
              y={PHILOSOPHY_RISE_HERO}
              duration={1}
            >
              {copy.hook[0]}
            </PhilosophyReveal>
            <PhilosophyReveal
              as={motion.span}
              onMount
              className="philosophy-page__hook-line philosophy-page__hook-line--echo block"
              y={PHILOSOPHY_RISE_HERO}
              duration={1}
              delay={PHILOSOPHY_HERO_ECHO_DELAY}
            >
              {copy.hook[1]}
            </PhilosophyReveal>
          </h1>
        </header>

        <motion.section
          className="brand-shell philosophy-page__tension"
          aria-label="Tension"
          initial={reduce ? false : "hidden"}
          whileInView={reduce ? undefined : "visible"}
          viewport={PHILOSOPHY_VIEWPORT}
          variants={reduce ? undefined : tensionContainer}
        >
          {copy.tension.map((line, index) => (
            <motion.p
              key={line}
              variants={reduce ? undefined : tensionItem}
              className={cn(
                "philosophy-page__tension-line",
                index === 1 && "philosophy-page__tension-line--offset",
                index === copy.tension.length - 1 &&
                  "philosophy-page__tension-line--emphasis philosophy-page__accent",
              )}
              style={staticVisible}
            >
              {line}
            </motion.p>
          ))}
        </motion.section>

        <motion.section
          className="brand-shell philosophy-page__authority"
          aria-label="Authority"
          initial={reduce ? false : "hidden"}
          whileInView={reduce ? undefined : "visible"}
          viewport={PHILOSOPHY_VIEWPORT_DEEP}
          variants={reduce ? undefined : authorityContainer}
        >
          <motion.p
            className="philosophy-page__authority-lead"
            variants={reduce ? undefined : authorityItem}
            style={staticVisible}
          >
            {copy.authority.lead}
          </motion.p>
          <motion.p
            className="philosophy-page__authority-line philosophy-page__accent"
            variants={reduce ? undefined : authorityItem}
            style={staticVisible}
          >
            {copy.authority.line}
          </motion.p>
        </motion.section>

        <section
          className="brand-shell philosophy-page__system"
          id="the-system"
          aria-labelledby="philosophy-system-heading"
        >
          <PhilosophyReveal viewport={PHILOSOPHY_VIEWPORT} y={12} duration={0.85}>
            <p id="philosophy-system-heading" className="brand-eyebrow">
              {copy.system.eyebrow}
            </p>
          </PhilosophyReveal>
          <motion.ol
            className="philosophy-page__pillars"
            initial={reduce ? false : "hidden"}
            whileInView={reduce ? undefined : "visible"}
            viewport={PHILOSOPHY_VIEWPORT}
            variants={reduce ? undefined : pillarContainer}
          >
            {copy.system.pillars.map((pillar) => (
              <motion.li
                key={pillar.index}
                variants={reduce ? undefined : pillarVariantsByIndex[pillar.index]}
                className={cn(
                  "philosophy-pillar",
                  `philosophy-pillar--${pillar.index}`,
                )}
                style={staticVisible}
              >
                <span className="philosophy-pillar__index">{pillar.index}</span>
                <div>
                  <h2 className="philosophy-pillar__title">{pillar.title}</h2>
                  <p className="philosophy-pillar__line">{pillar.line}</p>
                </div>
              </motion.li>
            ))}
          </motion.ol>
        </section>

        <motion.section
          className="brand-shell philosophy-page__filter"
          aria-label="Filter"
          initial={reduce ? false : "hidden"}
          whileInView={reduce ? undefined : "visible"}
          viewport={PHILOSOPHY_VIEWPORT}
          variants={reduce ? undefined : filterContainer}
        >
          {copy.filter.map((line) => (
            <motion.p
              key={line}
              variants={reduce ? undefined : filterItem}
              className="philosophy-page__filter-line"
              style={staticVisible}
            >
              {line}
            </motion.p>
          ))}
        </motion.section>

        <motion.section
          className="brand-shell philosophy-page__convert"
          aria-label="Apply"
          initial={reduce ? false : { opacity: 0, scale: 0.95 }}
          whileInView={reduce ? undefined : { opacity: 1, scale: 1 }}
          viewport={PHILOSOPHY_VIEWPORT_CTA}
          transition={
            reduce
              ? { duration: 0 }
              : {
                  duration: PHILOSOPHY_DURATION,
                  delay: PHILOSOPHY_CTA_DELAY,
                  ease: PHILOSOPHY_EASE,
                }
          }
        >
          <button
            type="button"
            onClick={() => openAssessment()}
            className="philosophy-page__cta"
          >
            {copy.cta.label}
          </button>
          <p className="philosophy-page__cta-sub">{copy.cta.subtext}</p>
          <p className="philosophy-page__support">{copy.support}</p>
        </motion.section>

        <div className="brand-shell next-drop-slot">
          <NextDropBanner />
          <PageExploreLinks excludeHref={BRAND_ROUTES.philosophy} />
        </div>
      </article>
    </BrandSiteLayout>
  );
}
