/**
 * Each Journal issue is written to one NRATLU print. The theme decides its
 * palette, its imagery and the scroll motion its scenes use — so the
 * Discipline issue rides, the Silence issue rises, and the Presence issue
 * unmasks.
 *
 * Kept free of imports from drops/collabs to avoid cycles: products and
 * prints are referenced by slug / id.
 */

export type JournalMotion = "ride" | "rise" | "unmask";

export type JournalTheme = {
  key: "ember" | "ascent" | "unmask";
  motion: JournalMotion;
  /** Accent pulled from the print. */
  tone: string;
  /** Page ground. */
  ground: string;
  /** Secondary hue — text accents, hairlines. */
  second: string;
  print: {
    id: string;
    number: string;
    title: string;
    image: string;
    alt: string;
    ratio: number;
  };
  /** Product page for the tee carrying this print. */
  productSlug: string;
  productName: string;
  /** Intro background — the print itself, blurred and dark. */
  intro: string;
  /** Full-bleed visual scene. */
  visual: { src: string; alt: string };
  /** Sticky media scene. */
  media: { src: string; alt: string };
  /** Model shot for the shop-the-print scene. */
  worn: { src: string; alt: string };
  /** Index cover. */
  cover: { src: string; alt: string };
};

const ART = "/images/drops/nratlu";
const SHOTS = `${ART}/shots`;

export const JOURNAL_THEMES: Record<string, JournalTheme> = {
  discipline: {
    key: "ember",
    motion: "ride",
    tone: "#e8742a",
    ground: "#05080f",
    second: "#7d93c4",
    print: {
      id: "print-01",
      number: "01",
      title: "Ember Rider",
      image: `${ART}/print-01-ember-rider.webp`,
      alt: "A rider on a galloping horse, both engulfed in flame, along a dark blue beach at dusk",
      ratio: 1433 / 944,
    },
    productSlug: "nratlu-ember-rider-tee",
    productName: "Ember Rider Tee",
    intro: `${ART}/print-01-ember-rider.webp`,
    visual: {
      src: `${SHOTS}/ember-wide.webp`,
      alt: "A man in the Ember Rider tee walks a dark beach at dusk while a burning horse and rider keep pace behind him",
    },
    media: {
      src: `${SHOTS}/ember-close.webp`,
      alt: "Close portrait in the Ember Rider tee, firelight on one side of the face, cold blue sea on the other",
    },
    worn: {
      src: `${SHOTS}/ember-front.webp`,
      alt: "Model in the Ember Rider tee on a night shore, flames on the rocks behind",
    },
    cover: {
      src: `${SHOTS}/ember-wide.webp`,
      alt: "Issue 01 — the burning shore",
    },
  },
  silence: {
    key: "ascent",
    motion: "rise",
    tone: "#e0432a",
    ground: "#0c0303",
    second: "#e9cdb4",
    print: {
      id: "print-02",
      number: "02",
      title: "Red Ascension",
      image: `${ART}/print-02-red-ascension.webp`,
      alt: "A cloaked warrior raising a sword on a hill beneath a vast red cloud sky pierced by a beam of light",
      ratio: 1,
    },
    productSlug: "nratlu-red-ascension-tee",
    productName: "Red Ascension Tee",
    intro: `${ART}/print-02-red-ascension.webp`,
    visual: {
      src: `${SHOTS}/red-wide.webp`,
      alt: "A man in the Red Ascension tee stands alone on a rocky crest under a blood-red sky, an army waiting below",
    },
    media: {
      src: `${SHOTS}/red-fist.webp`,
      alt: "Low-angle shot in the Red Ascension tee, fist raised into a red sky split by a beam of light",
    },
    worn: {
      src: `${SHOTS}/red-crimson.webp`,
      alt: "Portrait in the Red Ascension tee in crimson haze, a grey cloak over one shoulder",
    },
    cover: {
      src: `${SHOTS}/red-wide.webp`,
      alt: "Issue 02 — the red hill",
    },
  },
  presence: {
    key: "unmask",
    motion: "unmask",
    tone: "#d1241f",
    ground: "#0a0807",
    second: "#c9b39f",
    print: {
      id: "print-03",
      number: "03",
      title: "The Unmasking",
      image: `${ART}/print-03-the-unmasking.webp`,
      alt: "Engraved classical sculpture head turning, its face covered by a dark beast mask with a red bleeding eye",
      ratio: 1080 / 1898,
    },
    productSlug: "nratlu-the-unmasking-tee",
    productName: "The Unmasking Tee",
    intro: `${ART}/print-03-the-unmasking.webp`,
    visual: {
      src: `${SHOTS}/unmask-wide.webp`,
      alt: "A man in The Unmasking tee stands in a dark sculpture gallery cut by red light, a horned mask in his hand",
    },
    media: {
      src: `${SHOTS}/unmask-mask.webp`,
      alt: "The model lowers a black horned mask from his face, a classical statue behind him",
    },
    worn: {
      src: `${SHOTS}/unmask-studio.webp`,
      alt: "Portrait in The Unmasking tee, half the face in red light, a marble head in profile behind",
    },
    cover: {
      src: `${SHOTS}/unmask-wide.webp`,
      alt: "Issue 03 — the gallery after dark",
    },
  },
};

export function getJournalTheme(issueSlug: string): JournalTheme | undefined {
  return JOURNAL_THEMES[issueSlug];
}
