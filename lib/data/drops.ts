import { NRATLU_COLLAB, type CollabPrint } from "@/lib/data/collabs";
import { ASCEND_PRODUCT_IMAGES } from "@/lib/product-images";

export type DropCategory = "apparel" | "eyewear" | "accessories";

export type DropPrice = {
  amount: number;
  currency: string;
  display: string;
};

export type Drop = {
  slug: string;
  name: string;
  price: DropPrice;
  description: string;
  image: string;
  imageAlt: string;
  category: DropCategory;
  dropName: string;
  tagline: string;
  hero: {
    image: string;
    alt: string;
  };
  story: {
    headline: string;
    body: readonly string[];
  };
  visuals: readonly {
    src: string;
    alt: string;
    caption: string;
  }[];
  details: readonly string[];
  scarcity: {
    labels: readonly string[];
    stockRemaining: number;
    totalAllocation: number;
  };
  /** Apparel sizes — when set, a size must be chosen to buy. */
  sizes?: readonly string[];
  /** Printed garments from a collaboration — drives the themed product page. */
  print?: DropPrint;
};

export type DropShot = {
  src: string;
  alt: string;
  caption: string;
};

export type DropPrint = {
  collab: string;
  collabHref: string;
  /** The collab print this garment carries. */
  artwork: CollabPrint;
  theme: {
    /** Accent pulled from the artwork. */
    tone: string;
    /** Page ground colour. */
    ground: string;
    /** Secondary hue from the artwork. */
    second: string;
  };
  scenario: {
    title: string;
    lines: readonly string[];
  };
  /** Landscape scene for wide screens. */
  wide: DropShot;
  /** Portrait scenes — the first doubles as the phone hero. */
  portraits: readonly DropShot[];
  flat: DropShot;
  garment: readonly { label: string; value: string }[];
};

const DROP_IMAGES = {
  jacket: ASCEND_PRODUCT_IMAGES.teamStudio,
  vest: ASCEND_PRODUCT_IMAGES.lifestyleGolf,
  optics: ASCEND_PRODUCT_IMAGES.lifestyleAirport,
  carry: ASCEND_PRODUCT_IMAGES.lifestyleCoastal,
  architecture: ASCEND_PRODUCT_IMAGES.editorialArchitecture,
  dining: ASCEND_PRODUCT_IMAGES.brotherhoodDining,
} as const;

function formatPrice(amount: number, currency = "USD"): DropPrice {
  return {
    amount,
    currency,
    display: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount),
  };
}

function buildDrop(
  core: {
    slug: string;
    name: string;
    price: number;
    description: string;
    image: string;
    category: DropCategory;
    dropName: string;
    tagline: string;
    story: Drop["story"];
    visuals: Drop["visuals"];
    details: readonly string[];
    scarcity: Drop["scarcity"];
    heroImage?: string;
    gallery?: readonly { src: string; alt: string; caption: string }[];
    sizes?: readonly string[];
    print?: DropPrint;
  },
): Drop {
  const heroImage = core.heroImage ?? core.image;
  return {
    slug: core.slug,
    name: core.name,
    price: formatPrice(core.price),
    description: core.description,
    image: core.image,
    imageAlt: `${core.name} — ${core.dropName}`,
    category: core.category,
    dropName: core.dropName,
    tagline: core.tagline,
    hero: {
      image: heroImage,
      alt: `${core.name} — ${core.dropName} limited release`,
    },
    story: core.story,
    visuals: core.gallery ?? core.visuals,
    details: core.details,
    scarcity: core.scarcity,
    ...(core.sizes ? { sizes: core.sizes } : {}),
    ...(core.print ? { print: core.print } : {}),
  };
}

const SHOTS = "/images/drops/nratlu/shots";
const TEE_SIZES = ["S", "M", "L", "XL", "XXL"] as const;
const TEE_GARMENT = [
  { label: "Garment", value: "Oversized black crew-neck tee" },
  { label: "Fit", value: "Dropped shoulder, boxy body" },
  { label: "Fabric", value: "Heavyweight cotton jersey" },
  { label: "Print", value: "Full-colour front print of the original artwork" },
  { label: "Sizes", value: "S · M · L · XL · XXL" },
] as const;

function printOf(id: string): CollabPrint {
  const found = NRATLU_COLLAB.prints.find((p) => p.id === id);
  if (!found) throw new Error(`Missing collab print ${id}`);
  return found;
}

function buildPrintTee(core: {
  slug: string;
  printId: string;
  key: string;
  theme: DropPrint["theme"];
  tagline: string;
  scenario: DropPrint["scenario"];
  captions: { wide: string; front: string; close: string; flat: string };
  alts: { wide: string; front: string; close: string };
  files: { wide: string; front: string; close: string };
}): Drop {
  const art = printOf(core.printId);
  const name = `${art.title} Tee`;
  const shot = (file: string, alt: string, caption: string): DropShot => ({
    src: `${SHOTS}/${file}.webp`,
    alt,
    caption,
  });
  const wide = shot(core.files.wide, core.alts.wide, core.captions.wide);
  const front = shot(core.files.front, core.alts.front, core.captions.front);
  const close = shot(core.files.close, core.alts.close, core.captions.close);
  const flat = shot(
    `flat-${core.key}`,
    `${name} laid flat — black oversized tee with the ${art.title} print on the chest`,
    core.captions.flat,
  );

  return buildDrop({
    slug: core.slug,
    name,
    price: 110,
    description: art.standard,
    image: front.src,
    heroImage: wide.src,
    category: "apparel",
    dropName: `${NRATLU_COLLAB.dropName} · Print ${art.number}`,
    tagline: core.tagline,
    story: { headline: art.standard, body: art.body },
    visuals: [front, close, wide, flat],
    details: TEE_GARMENT.map((g) => g.value),
    scarcity: {
      labels: ["Ascend × NRATLU", "Print run"],
      stockRemaining: 10,
      totalAllocation: 10,
    },
    sizes: TEE_SIZES,
    print: {
      collab: NRATLU_COLLAB.title,
      collabHref: `/collab/nratlu#${art.id}`,
      artwork: art,
      theme: core.theme,
      scenario: core.scenario,
      wide,
      portraits: [front, close],
      flat,
      garment: TEE_GARMENT,
    },
  });
}

const NRATLU_TEES: readonly Drop[] = [
  buildPrintTee({
    slug: "nratlu-ember-rider-tee",
    printId: "print-01",
    key: "ember",
    theme: { tone: "#e8742a", ground: "#060912", second: "#3d5fa8" },
    tagline: "Ride through the fire.",
    scenario: {
      title: "The burning shore",
      lines: [
        "Dusk on cold blue water. A rider in full flame behind you.",
        "You don't look back. You keep the rhythm.",
      ],
    },
    files: { wide: "ember-wide", front: "ember-front", close: "ember-close" },
    alts: {
      wide: "Model in the Ember Rider tee walking a dark beach at dusk, a burning horse and rider behind him",
      front: "Model in the Ember Rider tee on a night shore, flames and embers on the rocks behind",
      close: "Close portrait in the Ember Rider tee, firelight on one side, cold blue sea on the other",
    },
    captions: {
      wide: "The burning shore · 01",
      front: "Firelight · 02",
      close: "Ember · 03",
      flat: "The tee · 04",
    },
  }),
  buildPrintTee({
    slug: "nratlu-red-ascension-tee",
    printId: "print-02",
    key: "red",
    theme: { tone: "#e0432a", ground: "#100404", second: "#e9cdb4" },
    tagline: "Rise before the army moves.",
    scenario: {
      title: "The red hill",
      lines: [
        "A sky torn open. An army waiting below.",
        "One figure on the crest. He goes first.",
      ],
    },
    files: { wide: "red-wide", front: "red-fist", close: "red-crimson" },
    alts: {
      wide: "Model in the Red Ascension tee on a rocky crest under a blood-red sky, an army with banners below",
      front: "Low-angle shot of the model in the Red Ascension tee, fist raised to a red sky split by light",
      close: "Portrait in the Red Ascension tee in crimson haze, a grey cloak over one shoulder",
    },
    captions: {
      wide: "The red hill · 01",
      front: "Ascent · 02",
      close: "Crimson · 03",
      flat: "The tee · 04",
    },
  }),
  buildPrintTee({
    slug: "nratlu-the-unmasking-tee",
    printId: "print-03",
    key: "unmask",
    theme: { tone: "#d1241f", ground: "#0b0908", second: "#c9b39f" },
    tagline: "Take off the beast.",
    scenario: {
      title: "The gallery after dark",
      lines: [
        "Marble heads in red light. A horned mask in his hand.",
        "The beast was the costume. This is the man.",
      ],
    },
    files: { wide: "unmask-wide", front: "unmask-mask", close: "unmask-studio" },
    alts: {
      wide: "Model in The Unmasking tee standing in a dark sculpture gallery lit red, holding a horned mask",
      front: "Model in The Unmasking tee lowering a black horned mask from his face, a classical statue behind",
      close: "Portrait in The Unmasking tee, half the face in red light, a marble head in profile behind",
    },
    captions: {
      wide: "The gallery · 01",
      front: "Unmasked · 02",
      close: "Profile · 03",
      flat: "The tee · 04",
    },
  }),
];

export const DROPS: readonly Drop[] = [
  ...NRATLU_TEES,
  buildDrop({
    slug: "ascend-jacket",
    name: "The Ascend Jacket",
    price: 480,
    description: "Matte shell. Structured silhouette.",
    image: DROP_IMAGES.jacket,
    category: "apparel",
    dropName: "Ascend / 01",
    tagline: "Built for presence.",
    story: {
      headline: "Not outerwear. A standard.",
      body: [
        "Designed for those who move in silence.",
        "A silhouette that reads before you speak.",
      ],
    },
    visuals: [
      {
        src: DROP_IMAGES.jacket,
        alt: "The Ascend Jacket — studio",
        caption: "Studio · 01",
      },
      {
        src: DROP_IMAGES.vest,
        alt: "The Ascend Jacket — field",
        caption: "Field · 02",
      },
      {
        src: DROP_IMAGES.architecture,
        alt: "The Ascend Jacket — structure",
        caption: "Structure · 03",
      },
    ],
    details: [
      "Matte shell",
      "Hidden carry",
      "Editorial cut",
      "Numbered run",
    ],
    scarcity: {
      labels: ["Limited Release", "No Restock"],
      stockRemaining: 47,
      totalAllocation: 120,
    },
  }),
  buildDrop({
    slug: "ascend-shell-vest",
    name: "The Shell Vest",
    price: 340,
    description: "Light layer. Clean lines.",
    image: DROP_IMAGES.vest,
    category: "apparel",
    dropName: "Ascend / 04",
    tagline: "Engineered for discipline.",
    story: {
      headline: "Structure without weight.",
      body: [
        "Between studio and street — posture without bulk.",
        "Matte. Minimal. Sharp under low light.",
      ],
    },
    visuals: [
      {
        src: DROP_IMAGES.vest,
        alt: "The Shell Vest — field",
        caption: "Field · 01",
      },
      {
        src: DROP_IMAGES.jacket,
        alt: "The Shell Vest — studio",
        caption: "Studio · 02",
      },
    ],
    details: [
      "Ripstop shell",
      "Interior pocket",
      "Relaxed fit",
      "Limited run",
    ],
    scarcity: {
      labels: ["Limited Release", "No Restock"],
      stockRemaining: 38,
      totalAllocation: 90,
    },
  }),
  buildDrop({
    slug: "ascend-optics",
    name: "Ascend Optics I",
    price: 320,
    description: "Hand-finished acetate. No lens theatre.",
    image: DROP_IMAGES.optics,
    category: "eyewear",
    dropName: "Ascend / 02",
    tagline: "See the room first.",
    story: {
      headline: "Posture, not accessory.",
      body: [
        "Cut for low light and long days.",
        "A frame that disappears until it is noticed.",
      ],
    },
    visuals: [
      {
        src: DROP_IMAGES.optics,
        alt: "Ascend Optics — transit",
        caption: "Transit · 01",
      },
      {
        src: DROP_IMAGES.architecture,
        alt: "Ascend Optics — structure",
        caption: "Lines · 02",
      },
    ],
    details: [
      "Acetate frame",
      "UV400 lenses",
      "Hidden hinge",
      "Matte case",
    ],
    scarcity: {
      labels: ["Limited Release", "No Restock"],
      stockRemaining: 31,
      totalAllocation: 80,
    },
  }),
  buildDrop({
    slug: "ascend-carry",
    name: "The Carry System",
    price: 260,
    description: "Modular interior. Matte hardware.",
    image: DROP_IMAGES.carry,
    category: "accessories",
    dropName: "Ascend / 03",
    tagline: "What you carry defines you.",
    story: {
      headline: "A mobile discipline kit.",
      body: [
        "Not a bag — a system for what you protect.",
        "Built to disappear against black.",
      ],
    },
    visuals: [
      {
        src: DROP_IMAGES.carry,
        alt: "The Carry System — coastal",
        caption: "Coast · 01",
      },
      {
        src: DROP_IMAGES.dining,
        alt: "The Carry System — interior",
        caption: "Interior · 02",
      },
    ],
    details: [
      "Matte exterior",
      "Modular interior",
      "Reinforced strap",
      "Embossed serial",
    ],
    scarcity: {
      labels: ["Limited Release", "No Restock"],
      stockRemaining: 22,
      totalAllocation: 60,
    },
  }),
] as const;

const dropMap = new Map(DROPS.map((d) => [d.slug, d]));

export function getDropBySlug(slug: string): Drop | undefined {
  return dropMap.get(slug);
}

export function getAllDropSlugs(): string[] {
  return DROPS.map((d) => d.slug);
}

export function getDropsByCategory(category: DropCategory): Drop[] {
  return DROPS.filter((d) => d.category === category);
}

export function getFeaturedDrop(): Drop {
  return DROPS[0]!;
}

/** The three NRATLU tees, in print order. */
export function getCollabTees(): readonly Drop[] {
  return NRATLU_TEES;
}

export function getTeeForPrint(printId: string): Drop | undefined {
  return NRATLU_TEES.find((d) => d.print?.artwork.id === printId);
}
