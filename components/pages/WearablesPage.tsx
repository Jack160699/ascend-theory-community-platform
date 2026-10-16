"use client";

import { BrandSiteLayout } from "@/components/brand/layout/BrandSiteLayout";
import { BrandWearables } from "@/components/brand/sections/BrandWearables";
import { NextDropBanner } from "@/components/brand/NextDropBanner";
import { PageExploreLinks } from "@/components/brand/PageExploreLinks";
import { AscendImage } from "@/components/AscendImage";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import { WEARABLES_INDEX } from "@/lib/data/wearables";
import { ASCEND_PRODUCT_IMAGES } from "@/lib/product-images";
import Link from "next/link";

export function WearablesPage() {
  return (
    <BrandSiteLayout orchestrate className="page-wearables page-wearables--visual">
      <header className="wearables-page-hero">
        <div className="wearables-page-hero__media ascend-media-wrap" aria-hidden>
          <AscendImage
            src={ASCEND_PRODUCT_IMAGES.heroStorefront}
            alt="Ascend Theory wearables"
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          <div className="wearables-page-hero__overlay" />
        </div>
        <div className="brand-shell wearables-page-hero__copy">
          <p className="brand-eyebrow">{WEARABLES_INDEX.eyebrow}</p>
          <h1 className="brand-display mt-6 max-w-[14ch]">
            {WEARABLES_INDEX.headline}
          </h1>
          <p className="brand-voice mt-8">{WEARABLES_INDEX.description}</p>
          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3">
            <Link href={BRAND_ROUTES.drops} className="brand-wearables-cta inline-flex">
              All drops →
            </Link>
            <Link href={BRAND_ROUTES.collab} className="brand-wearables-cta inline-flex">
              Next drop: × NRATLU →
            </Link>
          </div>
        </div>
      </header>
      <BrandWearables />
      <div className="brand-shell next-drop-slot">
        <NextDropBanner />
        <PageExploreLinks excludeHref={BRAND_ROUTES.wearables} />
      </div>
    </BrandSiteLayout>
  );
}
