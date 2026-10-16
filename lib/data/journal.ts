import { getJournalTheme, type JournalTheme } from "@/lib/data/journal-themes";

export type JournalSceneType =
  | "intro"
  | "visual"
  | "typography"
  | "text"
  | "media"
  | "artwork"
  | "shop"
  | "byline"
  | "signature"
  | "outro";

export type JournalScene = {
  id: string;
  type: JournalSceneType;
  /** One iconic beat per issue — larger type, contrast, pacing */
  peak?: boolean;
  /** Oversized intro lines */
  lines?: readonly string[];
  kicker?: string;
  /** Single statement scene */
  statement?: string;
  /** Short editorial lines */
  body?: readonly string[];
  image?: string;
  imageAlt?: string;
  caption?: string;
  /** Outro */
  closing?: string;
  /** Paused line-by-line rhythm (preferred over single closing) */
  closingLines?: readonly string[];
  subclosing?: string;
  outroLine?: string;
  /** Second emotional beat — split for pause */
  outroLineParts?: readonly string[];
  ctaLabel?: string;
  /** Byline scene — editorial credit */
  publishedDisplay?: string;
  /** Artwork scene — intrinsic ratio of the print. */
  ratio?: number;
  /** Shop scene — the tee carrying this issue's print. */
  productSlug?: string;
  productName?: string;
  /** Shop scene — the print shown beside the worn shot. */
  printImage?: string;
  printAlt?: string;
};

export type JournalIssue = {
  slug: string;
  number: string;
  title: string;
  theme: string;
  coverImage: string;
  coverAlt: string;
  articleSlug: string;
  /** Palette, imagery and scroll motion — matched to the issue's print. */
  look: JournalTheme;
};

export type JournalArticle = {
  slug: string;
  issueSlug: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  image: string;
  imageAlt: string;
  content: readonly string[];
  look: JournalTheme;
  /** Display date under byline (e.g. May 2026) */
  publishedDisplay: string;
  /** ISO-8601 for schema.org */
  publishedISO: string;
  scenes: readonly JournalScene[];
};

function themeFor(slug: string): JournalTheme {
  const theme = getJournalTheme(slug);
  if (!theme) throw new Error(`Missing journal theme: ${slug}`);
  return theme;
}

const ISSUE_CORE = [
  {
    slug: "discipline",
    number: "01",
    title: "DISCIPLINE",
    theme: "Structure before spectacle.",
    articleSlug: "discipline-as-aesthetics",
  },
  {
    slug: "silence",
    number: "02",
    title: "SILENCE",
    theme: "Focus charges interest.",
    articleSlug: "quiet-cost-of-focus",
  },
  {
    slug: "presence",
    number: "03",
    title: "PRESENCE",
    theme: "Strength without theatre.",
    articleSlug: "modern-masculinity-without-theatre",
  },
] as const;

/** Issue `theme` is the tagline; `look` is the visual + motion theme. */
export const JOURNAL_ISSUES: readonly JournalIssue[] = ISSUE_CORE.map((issue) => {
  const look = themeFor(issue.slug);
  return {
    ...issue,
    coverImage: look.cover.src,
    coverAlt: look.cover.alt,
    look,
  };
});

const ARTICLE_CORE = [
  {
    slug: "discipline-as-aesthetics",
    issueSlug: "discipline",
    title: "On discipline as aesthetics",
    excerpt: "Structure is the frame that makes expression legible.",
    date: "Issue 01 · Field note",
    readTime: "4",
    publishedDisplay: "May 2026",
    publishedISO: "2026-05-01",
    content: [
      "Discipline is not punishment. It is composition.",
      "When your days have rhythm, your choices have weight.",
      "Look at the rider. The fire is not the story. The gait is — four beats, held, while everything around him burns.",
      "That is what structure buys you: the ability to keep moving when the conditions turn on you.",
      "We do not design for motivation. We design for the person who already decided.",
    ],
  },
  {
    slug: "quiet-cost-of-focus",
    issueSlug: "silence",
    title: "The quiet cost of focus",
    excerpt: "Focus charges interest in sleep, spontaneity, and noise.",
    date: "Issue 02 · Essay",
    readTime: "6",
    publishedDisplay: "May 2026",
    publishedISO: "2026-05-15",
    content: [
      "Everyone wants the outcome. Few accept the invoice.",
      "You will miss dinners. You will answer late. That is allocation — not failure.",
      "Look at the hill. One figure, one raised blade, an army that has not moved yet. Ascent is quiet long before it is visible.",
      "Focus charges interest. The ones who rise pay it early, and alone.",
      "Silence became the new symbol of status.",
    ],
  },
  {
    slug: "modern-masculinity-without-theatre",
    issueSlug: "presence",
    title: "Modern masculinity, without theatre",
    excerpt: "Strength without performance. Presence without posturing.",
    date: "Issue 03 · Editorial",
    readTime: "5",
    publishedDisplay: "May 2026",
    publishedISO: "2026-05-18",
    content: [
      "The old script said: perform, dominate, announce.",
      "The new standard says: build, hold, move.",
      "Look at the bust. The beast is laid over the face like a costume — horned, loud, bleeding for attention.",
      "Underneath, the stone is calm. That is the man. Presence does not need the mask.",
      "No theatre. No slogans. Only the work.",
    ],
  },
] as const;

type ArticleCore = (typeof ARTICLE_CORE)[number];

function buildScenes(issue: JournalIssue, article: ArticleCore): JournalScene[] {
  const look = issue.look;
  /** One peak scene per issue */
  const peakTypography = issue.slug === "discipline" || issue.slug === "presence";
  const peakMedia = issue.slug === "silence";

  return [
    {
      id: "intro",
      type: "intro",
      kicker: `Issue ${issue.number} · Print ${look.print.number} · ${look.print.title}`,
      lines: [issue.title, article.title],
      image: look.intro,
      imageAlt: look.print.alt,
    },
    {
      id: "visual",
      type: "visual",
      image: look.visual.src,
      imageAlt: look.visual.alt,
      caption: article.excerpt,
    },
    {
      id: "typography",
      type: "typography",
      peak: peakTypography,
      statement: article.content[0],
    },
    {
      id: "text",
      type: "text",
      body: article.content.slice(1, -1),
      kicker: article.date,
    },
    {
      id: "artwork",
      type: "artwork",
      image: look.print.image,
      imageAlt: look.print.alt,
      ratio: look.print.ratio,
      kicker: `Print ${look.print.number} · Ascend Theory × NRATLU`,
      statement: look.print.title,
      caption: `The image Issue ${issue.number} was written to.`,
    },
    {
      id: "media",
      type: "media",
      peak: peakMedia,
      image: look.media.src,
      imageAlt: look.media.alt,
      statement: article.content[article.content.length - 1],
    },
    {
      id: "shop",
      type: "shop",
      kicker: `Wear Issue ${issue.number}`,
      statement: look.print.title,
      caption: issue.theme,
      image: look.worn.src,
      imageAlt: look.worn.alt,
      printImage: look.print.image,
      printAlt: look.print.alt,
      ratio: look.print.ratio,
      productSlug: look.productSlug,
      productName: look.productName,
    },
    {
      id: "byline",
      type: "byline",
      publishedDisplay: article.publishedDisplay,
    },
    {
      id: "signature",
      type: "signature",
    },
    {
      id: "outro",
      type: "outro",
      closingLines: ["Not everyone enters."],
      outroLineParts: ["Those who do—", "build differently."],
      subclosing: issue.theme,
      ctaLabel: "Return to Journal",
    },
  ];
}

const issueMap = new Map(JOURNAL_ISSUES.map((i) => [i.slug, i]));

export const JOURNAL_ARTICLES: readonly JournalArticle[] = ARTICLE_CORE.map(
  (article) => {
    const issue = issueMap.get(article.issueSlug)!;
    return {
      ...article,
      image: issue.look.visual.src,
      imageAlt: issue.look.visual.alt,
      look: issue.look,
      scenes: buildScenes(issue, article),
    };
  },
);

const journalMap = new Map(JOURNAL_ARTICLES.map((a) => [a.slug, a]));

export function getJournalIssueBySlug(slug: string): JournalIssue | undefined {
  return JOURNAL_ISSUES.find((i) => i.slug === slug);
}

export function getJournalIssueByArticleSlug(
  articleSlug: string,
): JournalIssue | undefined {
  return JOURNAL_ISSUES.find((i) => i.articleSlug === articleSlug);
}

export function getJournalBySlug(slug: string): JournalArticle | undefined {
  return journalMap.get(slug);
}

export function getAllJournalSlugs(): string[] {
  return JOURNAL_ARTICLES.map((a) => a.slug);
}

export const JOURNAL_INDEX = {
  eyebrow: "Journal",
  headline: "A luxury publication.",
  subline: "Issue-based editorials. Cinematic pacing. No noise.",
  statement: "Scroll is the medium.",
} as const;
