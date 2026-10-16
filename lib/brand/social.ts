/** Instagram pages linked across the site — single source for every social link. */

export type SocialPage = {
  handle: string;
  href: string;
  label: string;
  role: string;
};

export const INSTAGRAM = {
  ascend: {
    handle: "@ascendtheory.in",
    href: "https://www.instagram.com/ascendtheory.in/",
    label: "Ascend Theory on Instagram",
    role: "The house",
  },
  nratlu: {
    handle: "@nratlu",
    href: "https://www.instagram.com/nratlu/",
    label: "NRATLU on Instagram",
    role: "The collaborator",
  },
} as const satisfies Record<string, SocialPage>;

/** Order used wherever both pages appear together. */
export const COLLAB_INSTAGRAM_PAGES: readonly SocialPage[] = [
  INSTAGRAM.ascend,
  INSTAGRAM.nratlu,
];
