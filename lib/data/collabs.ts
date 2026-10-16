import { INSTAGRAM, type SocialPage } from "@/lib/brand/social";

export type CollabPrint = {
  /** Anchor id on the collab page — `#print-01` etc. */
  id: string;
  number: string;
  title: string;
  line: string;
  body: string;
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
  prints: readonly CollabPrint[];
};

const IMG = "/images/drops/nratlu";

export const NRATLU_COLLAB: Collab = {
  slug: "nratlu",
  dropName: "Ascend / 05",
  title: "Ascend Theory × NRATLU",
  partner: INSTAGRAM.nratlu,
  house: INSTAGRAM.ascend,
  status: "Next drop",
  headline: "Three prints. One run.",
  statement: [
    "Fire, blood and the moment before the climb.",
    "Built with NRATLU. Released on both pages first.",
  ],
  prints: [
    {
      id: "print-01",
      number: "01",
      title: "Ember Rider",
      line: "What chases you becomes what carries you.",
      body: "A rider and horse in full flame on a cold blue shore. Momentum over comfort.",
      image: `${IMG}/print-01-ember-rider.webp`,
      alt: "A rider on a galloping horse, both engulfed in flame, along a dark blue beach at dusk",
      ratio: 1433 / 944,
      tone: "#e8742a",
    },
    {
      id: "print-02",
      number: "02",
      title: "Red Ascension",
      line: "The army waits. The one who rises goes first.",
      body: "A lone cloaked figure lifts a blade into a sky torn open by light. Command before crowd.",
      image: `${IMG}/print-02-red-ascension.webp`,
      alt: "A cloaked warrior raising a sword on a hill beneath a vast red cloud sky pierced by a beam of light, armies below",
      ratio: 1,
      tone: "#d4402b",
    },
    {
      id: "print-03",
      number: "03",
      title: "The Unmasking",
      line: "The beast was a mask. The man underneath is the point.",
      body: "An etched classical head half-swallowed by black and red. Identity, stripped back.",
      image: `${IMG}/print-03-the-unmasking.webp`,
      alt: "Engraved classical sculpture head turning, its face covered by a dark beast mask with a red bleeding eye",
      ratio: 1080 / 1898,
      tone: "#c3201f",
    },
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
