"use client";

import { AscendImage } from "@/components/AscendImage";
import { JournalReveal } from "@/components/journal/JournalReveal";
import { NextDropBanner } from "@/components/brand/NextDropBanner";
import { PageExploreLinks } from "@/components/brand/PageExploreLinks";
import { BrandSiteLayout } from "@/components/brand/layout/BrandSiteLayout";
import { JOURNAL_INDEX, JOURNAL_ISSUES } from "@/lib/data/journal";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import {
  JOURNAL_DURATION_SLOW,
  JOURNAL_RISE,
  JOURNAL_STAGGER,
} from "@/lib/motion/journal-motion";
import { JOURNAL_EASE } from "@/lib/motion/journal-motion";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";

export function JournalMagazineIndex() {
  const reduce = useReducedMotion();

  return (
    <BrandSiteLayout
      className="page-journal page-journal--magazine"
      canvasClassName="journal-index-canvas"
      scrollVariant="editorial"
    >
      <div className="journal-index">
        <header className="journal-index__hero">
          <JournalReveal onMount y={20} duration={0.9}>
            <p className="journal-index__eyebrow">{JOURNAL_INDEX.eyebrow}</p>
          </JournalReveal>
          <JournalReveal onMount delay={0.15} y={JOURNAL_RISE} duration={JOURNAL_DURATION_SLOW}>
            <h1 className="journal-index__title">{JOURNAL_INDEX.headline}</h1>
          </JournalReveal>
          <JournalReveal onMount delay={0.3} y={16} duration={1}>
            <p className="journal-index__subline">{JOURNAL_INDEX.subline}</p>
          </JournalReveal>
          <JournalReveal onMount delay={0.45} y={12}>
            <p className="journal-index__statement">{JOURNAL_INDEX.statement}</p>
          </JournalReveal>
        </header>

        <motion.div
          className="journal-index__issues"
          initial={reduce ? false : "hidden"}
          whileInView={reduce ? undefined : "visible"}
          viewport={{ once: true, amount: 0.2 }}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: JOURNAL_STAGGER } },
          }}
        >
          {JOURNAL_ISSUES.map((issue) => (
            <motion.article
              key={issue.slug}
              variants={{
                hidden: { opacity: 0, y: 40 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 1.05, ease: JOURNAL_EASE },
                },
              }}
            >
              <Link
                href={BRAND_ROUTES.journalArticle(issue.articleSlug)}
                className="journal-issue-card group"
              >
                <div className="journal-issue-card__media">
                  <div className="journal-issue-card__media-zoom">
                    <AscendImage
                      src={issue.coverImage}
                      alt={issue.coverAlt}
                      fill
                      sizes="(max-width: 768px) 100vw, 50vw"
                      className="object-cover object-center"
                    />
                  </div>
                  <div className="journal-issue-card__shade" aria-hidden />
                  <div className="journal-issue-card__gradient" aria-hidden />
                </div>
                <div className="journal-issue-card__copy">
                  <div className="journal-issue-card__stack">
                    <p className="journal-issue-card__number">
                      Issue {issue.number}
                    </p>
                    <h2 className="journal-issue-card__title">{issue.title}</h2>
                    <p className="journal-issue-card__theme">{issue.theme}</p>
                  </div>
                  <p className="journal-issue-card__enter">Enter issue →</p>
                </div>
              </Link>
            </motion.article>
          ))}
        </motion.div>

        <div className="next-drop-slot">
          <NextDropBanner />
          <PageExploreLinks excludeHref={BRAND_ROUTES.journal} />
        </div>
      </div>
    </BrandSiteLayout>
  );
}
