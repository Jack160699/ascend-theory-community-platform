import { AscendImage } from "@/components/AscendImage";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import { getFeaturedCollab } from "@/lib/data/collabs";
import { cn } from "@/lib/utils";
import Link from "next/link";

type NextDropBannerProps = {
  className?: string;
  /** Hide the Instagram row when the surrounding section already shows it. */
  showSocial?: boolean;
};

/**
 * Cross-site entry to the current collaboration drop. Each print thumbnail
 * deep-links to its own section on the collab page.
 */
export function NextDropBanner({ className, showSocial = true }: NextDropBannerProps) {
  const collab = getFeaturedCollab();

  return (
    <section className={cn("next-drop", className)} aria-label={`${collab.status}: ${collab.title}`}>
      <div className="next-drop__copy">
        <p className="brand-eyebrow">
          {collab.status} · {collab.dropName}
        </p>
        <Link href={BRAND_ROUTES.collab} className="next-drop__title">
          {collab.title}
        </Link>
        <p className="next-drop__line">{collab.headline}</p>
        <Link href={BRAND_ROUTES.collab} className="next-drop__cta">
          Enter the drop <span aria-hidden>→</span>
        </Link>
        {showSocial ? <SocialLinks className="mt-6" /> : null}
      </div>

      <ul className="next-drop__prints">
        {collab.prints.map((print) => (
          <li key={print.id}>
            <Link
              href={BRAND_ROUTES.collabPrint(print.id)}
              className="next-drop__print group"
              aria-label={`Print ${print.number}: ${print.title}`}
            >
              <span className="next-drop__thumb">
                <AscendImage
                  src={print.image}
                  alt={print.alt}
                  fill
                  sizes="(max-width: 768px) 30vw, 14rem"
                  className="object-cover object-center transition-transform duration-500 group-hover:scale-105"
                />
              </span>
              <span className="next-drop__print-meta">
                <span className="next-drop__print-no">{print.number}</span>
                <span className="next-drop__print-title">{print.title}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
