"use client";

import { BrandSiteLayout } from "@/components/brand/layout/BrandSiteLayout";
import { AscendImage } from "@/components/AscendImage";
import { NextDropBanner } from "@/components/brand/NextDropBanner";
import { PageExploreLinks } from "@/components/brand/PageExploreLinks";
import { DROPS } from "@/lib/data/drops";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import Link from "next/link";

export function DropsPage() {
  return (
    <BrandSiteLayout className="page-drops page-drops--index">
      <div className="brand-shell drops-page">
        <header className="drops-page__header">
          <p className="brand-eyebrow">Drops</p>
          <h1 className="brand-display mt-6 max-w-[12ch]">No restock.</h1>
          <p className="brand-voice mt-8">One run per release. Then closed.</p>
        </header>

        <NextDropBanner />

        <ul className="drops-grid">
          {DROPS.map((drop) => (
            <li key={drop.slug}>
              <Link href={BRAND_ROUTES.drop(drop.slug)} className="drops-card group">
                <div className="drops-card__media ascend-media-wrap">
                  <AscendImage
                    src={drop.image}
                    alt={drop.imageAlt}
                    fill
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="object-cover object-center transition-transform duration-500 ease-[cubic-bezier(0.33,1,0.68,1)] group-hover:scale-105"
                  />
                  <div className="drops-card__shade" />
                </div>
                <div className="drops-card__copy">
                  <p className="brand-eyebrow">{drop.dropName}</p>
                  <h2 className="drops-card__title">{drop.name}</h2>
                  <p className="brand-voice mt-3">{drop.description}</p>
                  <p className="drops-card__tagline mt-2">{drop.tagline}</p>
                  <p className="drops-card__price mt-5">{drop.price.display}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        <PageExploreLinks excludeHref={BRAND_ROUTES.drops} />
      </div>
    </BrandSiteLayout>
  );
}

