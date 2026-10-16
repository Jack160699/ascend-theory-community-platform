"use client";

import { JournalMinimalNav } from "@/components/journal/JournalMinimalNav";
import { JournalScene } from "@/components/journal/JournalScene";
import type { JournalArticle } from "@/lib/data/journal";
import { NextDropBanner } from "@/components/brand/NextDropBanner";
import { PageExploreLinks } from "@/components/brand/PageExploreLinks";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import { useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, type CSSProperties } from "react";

type JournalCinematicArticleProps = {
  article: JournalArticle;
};

export function JournalCinematicArticle({ article }: JournalCinematicArticleProps) {
  const reduce = useReducedMotion();

  useEffect(() => {
    document.documentElement.classList.add("journal-article-chrome");
    document.body.classList.add("journal-article-chrome");
    return () => {
      document.documentElement.classList.remove("journal-article-chrome");
      document.body.classList.remove("journal-article-chrome");
    };
  }, []);

  useEffect(() => {
    if (reduce) return;
    gsap.registerPlugin(ScrollTrigger);
    const id = requestAnimationFrame(() => {
      ScrollTrigger.refresh();
    });
    const onResize = () => ScrollTrigger.refresh();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
    };
  }, [article.slug, reduce]);

  return (
    <div
      className="journal-immersive journal-immersive--native"
      data-look={article.look.key}
      style={
        {
          "--j-tone": article.look.tone,
          "--j-ground": article.look.ground,
          "--j-second": article.look.second,
        } as CSSProperties
      }
    >
      <JournalMinimalNav
        backHref={BRAND_ROUTES.journal}
        backLabel="Journal"
      />
      <article className="journal-article-flow">
        {article.scenes.map((scene, index) => (
          <JournalScene key={scene.id} scene={scene} index={index} motionStyle={article.look.motion} />
        ))}
      </article>
      <div className="journal-article-explore">
        <NextDropBanner />
        <PageExploreLinks />
      </div>
    </div>
  );
}
