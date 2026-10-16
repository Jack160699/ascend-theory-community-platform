"use client";

import { HeroCinematicBackground } from "@/components/brand/hero/HeroCinematicBackground";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { BRAND, HERO_PORTAL_SUBLINE } from "@/lib/brand/content";
import { PORTAL_DIRECTIONS } from "@/lib/brand/routes";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const SUBTEXT_DELAY_MS = 800;
const HIDE_TEXT_DELAY_MS = 2500;
const DIRECTIONS_DELAY_MS = 3000;
const NAVIGATE_DELAY_MS = 800;

/** Shared editorial grid + type rhythm */
const GRID_LEFT = "left-[6%] md:left-[8%]";
const GRID_RIGHT = "right-[6%] md:right-[8%]";
const LOGO_TOP = "top-[5%] md:top-[6%]";
const MENU_TOP = "top-[34%] md:top-[30%]";
const ANCHOR_TOP = "top-[45%]";
const TRACKING = "tracking-[0.25em]";

const MENU_ITEM_CLASS = cn(
  "m-0 cursor-pointer border-0 bg-transparent p-0 text-right font-light uppercase whitespace-nowrap",
  "text-[clamp(24px,4.4vw,56px)] leading-[1.35] text-white/70 opacity-0",
  TRACKING,
  "transition-[color,transform,opacity] duration-300 hover:scale-105 hover:text-white",
);

function subscribeReduce(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getReduceSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getReduceServerSnapshot() {
  return false;
}

/**
 * Luxury editorial portal — typography-led menu over atmospheric video.
 */
export function CinematicPortalHero() {
  const router = useRouter();
  const reduceMotion = useSyncExternalStore(
    subscribeReduce,
    getReduceSnapshot,
    getReduceServerSnapshot,
  );

  const [showSubtext, setShowSubtext] = useState(false);
  const [hideText, setHideText] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const subtextDelay = reduceMotion ? 0 : SUBTEXT_DELAY_MS;
    const hideTextDelay = reduceMotion ? 0 : HIDE_TEXT_DELAY_MS;
    const directionsDelay = reduceMotion ? 0 : DIRECTIONS_DELAY_MS;

    const subtextTimer = window.setTimeout(
      () => setShowSubtext(true),
      subtextDelay,
    );
    const hideTextTimer = window.setTimeout(
      () => setHideText(true),
      hideTextDelay,
    );
    const directionsTimer = window.setTimeout(
      () => setShowDirections(true),
      directionsDelay,
    );

    return () => {
      window.clearTimeout(subtextTimer);
      window.clearTimeout(hideTextTimer);
      window.clearTimeout(directionsTimer);
    };
  }, [reduceMotion]);

  const handleDirectionClick = useCallback(
    (href: string) => {
      if (isTransitioning) return;
      setIsTransitioning(true);
      window.setTimeout(() => {
        router.push(href);
      }, NAVIGATE_DELAY_MS);
    },
    [isTransitioning, router],
  );

  return (
    <section
      className="portal-screen portal-screen--locked fixed inset-0 z-0 h-screen w-screen overflow-hidden overscroll-none touch-none"
      aria-label="Ascend Theory entry"
    >
      <HeroCinematicBackground variant="editorial" />

      <div className="relative h-full w-full overflow-hidden px-6 py-6 md:px-12 md:py-10">
        <p
          className={cn(
            "absolute z-20 text-xs font-light text-white/80 md:text-sm",
            GRID_LEFT,
            LOGO_TOP,
            TRACKING,
          )}
          aria-hidden={hideText && showDirections}
        >
          {BRAND.mark}
        </p>

        <div
          className={cn(
            "pointer-events-none absolute z-10 text-left transition-[opacity,transform] duration-[850ms] ease-[cubic-bezier(0.33,1,0.68,1)]",
            GRID_LEFT,
            ANCHOR_TOP,
            hideText && "-translate-y-2.5 opacity-0",
          )}
          aria-hidden={hideText && showDirections}
        >
          <h1
            className={cn(
              "m-0 whitespace-nowrap font-light leading-[1.4] text-white",
              "text-[clamp(1.5rem,4vw,2.75rem)]",
              TRACKING,
            )}
          >
            {BRAND.mark}
          </h1>
          <p
            className={cn(
              "m-0 mt-6 font-light uppercase leading-[1.6] text-white/60",
              "text-[clamp(0.65rem,1.2vw,0.85rem)]",
              TRACKING,
              "transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.33,1,0.68,1)]",
              showSubtext ? "translate-y-0 opacity-100" : "translate-y-3.5 opacity-0",
            )}
          >
            {HERO_PORTAL_SUBLINE}
          </p>
        </div>

        <nav
          className={cn(
            "absolute z-[12] flex max-h-[62vh] flex-col items-end space-y-5 text-right leading-[1.6] md:space-y-6",
            GRID_RIGHT,
            MENU_TOP,
            showDirections ? "pointer-events-auto" : "pointer-events-none",
          )}
          aria-label="Enter the brand"
          aria-hidden={!showDirections}
        >
          {PORTAL_DIRECTIONS.map((item) => (
            <button
              key={item.href}
              type="button"
              disabled={!showDirections || isTransitioning}
              className={cn(
                MENU_ITEM_CLASS,
                "shrink-0 origin-right disabled:cursor-default",
                showDirections && "animate-rise",
              )}
              style={{ animationDelay: item.stagger }}
              onClick={() => handleDirectionClick(item.href)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div
          className={cn(
            "portal-social transition-opacity duration-700",
            showDirections ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          aria-hidden={!showDirections}
        >
          <SocialLinks />
        </div>
      </div>

      <div
        className={cn(
          "portal-cinematic__transition",
          isTransitioning && "portal-cinematic__transition--active",
        )}
        aria-hidden
      />
    </section>
  );
}
