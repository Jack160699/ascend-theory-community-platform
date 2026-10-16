import { PHILOSOPHY_PAGE } from "@/lib/brand/content";
import { INSTAGRAM, type SocialPage } from "@/lib/brand/social";
import { getJournalBySlug, JOURNAL_ISSUES } from "@/lib/data/journal";

export type CollabLink = {
  href: string;
  label: string;
  kicker: string;
};

export type CollabPrint = {
  /** Anchor id on the collab page — `#print-01` etc. */
  id: string;
  number: string;
  title: string;
  /** Philosophy pillar this print stands for. */
  pillar: string;
  /** H3 — the pillar's line from the Philosophy page. */
  standard: string;
  /** Body — print description joined to the matching Journal issue. */
  body: readonly string[];
  /** Pull line from the Journal issue. */
  quote: string;
  journal: CollabLink;
  philosophy: CollabLink;
  image: string;
  alt: string;
  /** Intrinsic ratio of the artwork, width / height. */
  ratio: number;
  /** Accent pulled from the artwork for its section. */
  tone: string;
};

export type Collab = {
  slug: string;
  dropName: string;
  title: string;
  partner: SocialPage;
  house: SocialPage;
  status: string;
  headline: string;
  statement: readonly string[];
  video: {
    desktop: string;
    mobile: string;
    desktopPoster: string;
    mobilePoster: string;
  };
  prints: readonly CollabPrint[];
};

const IMG = "/images/drops/nratlu";

function pillar(title: string) {
  const found = PHILOSOPHY_PAGE.system.pillars.find((p) => p.title === title);
  if (!found) throw new Error(`Missing philosophy pillar: ${title}`);
  return found;
}

function journal(issueSlug: string) {
  const issue = JOURNAL_ISSUES.find((i) => i.slug === issueSlug);
  const article = issue ? getJournalBySlug(issue.articleSlug) : undefined;
  if (!issue || !article) throw new Error(`Missing journal issue: ${issueSlug}`);
  return { issue, article };
}

function printFrom(
  core: {
    id: string;
    number: string;
    title: string;
    pillar: string;
    issue: string;
    lead: string;
    quoteIndex: number;
    image: string;
    alt: string;
    ratio: number;
    tone: string;
  },
): CollabPrint {
  const p = pillar(core.pillar);
  const { issue, article } = journal(core.issue);
  return {
    id: core.id,
    number: core.number,
    title: core.title,
    pillar: p.title,
    standard: p.line,
    body: [core.lead, `${issue.theme} ${article.content[0]}`],
    quote: article.content[core.quoteIndex] ?? article.excerpt,
    journal: {
      href: `/journal/${article.slug}`,
      kicker: `Journal · Issue ${issue.number}`,
      label: article.title,
    },
    philosophy: {
      href: "/philosophy#the-system",
      kicker: `Philosophy · ${p.index}`,
      label: p.title,
    },
    image: core.image,
    alt: core.alt,
    ratio: core.ratio,
    tone: core.tone,
  };
}

export const NRATLU_COLLAB: Collab = {
  slug: "nratlu",
  dropName: "Ascend / 05",
  title: "Ascend Theory × NRATLU",
  partner: INSTAGRAM.nratlu,
  house: INSTAGRAM.ascend,
  status: "Next drop",
  headline: "Three prints. Three standards.",
  statement: [
    "Discipline. Ascent. Identity.",
    "Built with NRATLU. Released on both pages first.",
  ],
  video: {
    desktop: "/videos/nratlu-desktop.mp4",
    mobile: "/videos/nratlu-mobile.mp4",
    desktopPoster: "/videos/nratlu-desktop-poster.webp",
    mobilePoster: "/videos/nratlu-mobile-poster.webp",
  },
  prints: [
    printFrom({
      id: "print-01",
      number: "01",
      title: "Ember Rider",
      pillar: "Discipline",
      issue: "discipline",
      lead: "The fire doesn't stop the ride. It keeps the rhythm.",
      quoteIndex: 1,
      image: `${IMG}/print-01-ember-rider.webp`,
      alt: "A rider on a galloping horse, both engulfed in flame, along a dark blue beach at dusk",
      ratio: 1433 / 944,
      tone: "#e8742a",
    }),
    printFrom({
      id: "print-02",
      number: "02",
      title: "Red Ascension",
      pillar: "Ascent",
      issue: "silence",
      lead: "One blade raised while the army waits below.",
      quoteIndex: 2,
      image: `${IMG}/print-02-red-ascension.webp`,
      alt: "A cloaked warrior raising a sword on a hill beneath a vast red cloud sky pierced by a beam of light, armies below",
      ratio: 1,
      tone: "#d4402b",
    }),
    printFrom({
      id: "print-03",
      number: "03",
      title: "The Unmasking",
      pillar: "Identity",
      issue: "presence",
      lead: "The beast was the mask. What's underneath is the man.",
      quoteIndex: 1,
      image: `${IMG}/print-03-the-unmasking.webp`,
      alt: "Engraved classical sculpture head turning, its face covered by a dark beast mask with a red bleeding eye",
      ratio: 1080 / 1898,
      tone: "#c3201f",
    }),
  ],
};

export const COLLABS: readonly Collab[] = [NRATLU_COLLAB];

export function getCollabBySlug(slug: string): Collab | undefined {
  return COLLABS.find((c) => c.slug === slug);
}

/** The collaboration currently promoted across the site. */
export function getFeaturedCollab(): Collab {
  return NRATLU_COLLAB;
}
