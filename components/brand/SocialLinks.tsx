import { COLLAB_INSTAGRAM_PAGES, type SocialPage } from "@/lib/brand/social";
import { cn } from "@/lib/utils";

export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-[1em] w-[1em] shrink-0", className)}
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

type SocialLinksProps = {
  pages?: readonly SocialPage[];
  /** `inline` — compact handles; `cards` — bordered tiles with role labels. */
  variant?: "inline" | "cards";
  className?: string;
};

/** Both Instagram pages, side by side — used in nav, footer, explore and the collab page. */
export function SocialLinks({
  pages = COLLAB_INSTAGRAM_PAGES,
  variant = "inline",
  className,
}: SocialLinksProps) {
  if (variant === "cards") {
    return (
      <ul className={cn("social-cards", className)}>
        {pages.map((page) => (
          <li key={page.href}>
            <a
              href={page.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={page.label}
              className="social-card group"
            >
              <span className="social-card__role">{page.role}</span>
              <span className="social-card__handle">
                <InstagramGlyph />
                {page.handle}
              </span>
              <span className="social-card__cta">
                Follow on Instagram <span aria-hidden>↗</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className={cn("social-inline", className)}>
      {pages.map((page) => (
        <li key={page.href}>
          <a
            href={page.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={page.label}
            className="social-inline__link"
          >
            <InstagramGlyph />
            <span>{page.handle}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
