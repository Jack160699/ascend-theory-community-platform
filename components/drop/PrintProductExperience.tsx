"use client";

import { AscendImage } from "@/components/AscendImage";
import { BrandNav } from "@/components/brand/BrandNav";
import { PageExploreLinks } from "@/components/brand/PageExploreLinks";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { useCart } from "@/contexts/cart";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import { getCollabTees, type Drop, type DropPrint, type DropShot } from "@/lib/data/drops";
import { cn } from "@/lib/utils";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

const EASE = [0.33, 1, 0.68, 1] as const;

/* ───────────────────────── Purchase state ───────────────────────── */

function usePurchase(product: Drop) {
  const { addProduct } = useCart();
  const router = useRouter();
  const [size, setSize] = useState<string | null>(null);
  const [needsSize, setNeedsSize] = useState(false);
  const [added, setAdded] = useState(false);

  const pick = useCallback((s: string) => {
    setSize(s);
    setNeedsSize(false);
  }, []);

  const ensureSize = useCallback(() => {
    if (size) return size;
    setNeedsSize(true);
    document.getElementById("buy")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return null;
  }, [size]);

  const addToCart = useCallback(() => {
    const s = ensureSize();
    if (!s) return;
    addProduct(product.slug, s);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1400);
  }, [addProduct, ensureSize, product.slug]);

  const buyNow = useCallback(() => {
    const s = ensureSize();
    if (!s) return;
    addProduct(product.slug, s, { openDrawer: false });
    // Let the cart persist before the checkout page reads it.
    window.setTimeout(() => router.push(BRAND_ROUTES.checkout), 120);
  }, [addProduct, ensureSize, product.slug, router]);

  return { size, pick, needsSize, added, addToCart, buyNow };
}

type Purchase = ReturnType<typeof usePurchase>;

function SizePicker({ sizes, purchase, compact }: { sizes: readonly string[]; purchase: Purchase; compact?: boolean }) {
  return (
    <fieldset className={cn("pp-sizes", compact && "pp-sizes--compact", purchase.needsSize && "pp-sizes--alert")}>
      <legend className="pp-sizes__legend">
        Size{purchase.size ? <b> · {purchase.size}</b> : null}
        {purchase.needsSize ? <span className="pp-sizes__hint">Choose a size</span> : null}
      </legend>
      <div className="pp-sizes__row" role="radiogroup" aria-label="Size">
        {sizes.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={purchase.size === s}
            className={cn("pp-size", purchase.size === s && "is-on")}
            onClick={() => purchase.pick(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function BuyButtons({ product, purchase }: { product: Drop; purchase: Purchase }) {
  return (
    <div className="pp-buy__actions">
      <button type="button" className="pp-btn pp-btn--primary" onClick={purchase.buyNow}>
        Buy now · {product.price.display}
      </button>
      <button type="button" className="pp-btn" onClick={purchase.addToCart}>
        {purchase.added ? "Added to cart" : "Add to cart"}
      </button>
    </div>
  );
}

/* ───────────────────────── Sections ───────────────────────── */

function Hero({ product, print }: { product: Drop; print: DropPrint }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.14]);
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "12%"]);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const art = print.artwork;

  return (
    <section ref={ref} id="drop-hero" className="pp-hero" aria-labelledby="pp-title">
      <motion.div className="pp-hero__media" style={reduce ? undefined : { scale, y }} aria-hidden>
        <div className="pp-hero__img pp-hero__img--wide">
          <AscendImage src={print.wide.src} alt="" fill priority sizes="100vw" className="object-cover" />
        </div>
        <div className="pp-hero__img pp-hero__img--tall">
          <AscendImage src={print.portraits[0]!.src} alt="" fill priority sizes="100vw" className="object-cover" />
        </div>
      </motion.div>
      <div className="pp-hero__shade" aria-hidden />

      <motion.div className="drop-shell pp-hero__copy" style={reduce ? undefined : { opacity: fade }}>
        <motion.p
          className="pp-eyebrow"
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
        >
          <Link href={print.collabHref}>{print.collab}</Link> · Print {art.number} · {art.pillar}
        </motion.p>
        <motion.h1
          id="pp-title"
          className="pp-hero__title"
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: 0.35 }}
        >
          {art.title}
          <span className="pp-hero__kind">Tee</span>
        </motion.h1>
        <motion.p
          className="pp-hero__line"
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.55 }}
        >
          {product.tagline}
        </motion.p>
        <motion.div
          className="pp-hero__cta"
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.75 }}
        >
          <a href="#buy" className="pp-btn pp-btn--primary">
            Shop · {product.price.display}
          </a>
          <a href="#scene" className="pp-hero__scene">
            {print.scenario.title} <span aria-hidden>↓</span>
          </a>
        </motion.div>
      </motion.div>
    </section>
  );
}

function BuySection({ product, print, purchase }: { product: Drop; print: DropPrint; purchase: Purchase }) {
  const gallery: DropShot[] = [print.portraits[0]!, print.flat, print.portraits[1]!, print.wide];
  const [active, setActive] = useState(0);
  const current = gallery[active]!;
  const art = print.artwork;

  return (
    <section id="buy" className="pp-buy" aria-label={`Buy the ${product.name}`}>
      <div className="drop-shell pp-buy__grid">
        <div className="pp-gallery">
          <div className="pp-gallery__main">
            {gallery.map((shot, i) => (
              <div key={shot.src} className={cn("pp-gallery__slide", i === active && "is-on")} aria-hidden={i !== active}>
                <AscendImage
                  src={shot.src}
                  alt={shot.alt}
                  fill
                  sizes="(max-width: 899px) 100vw, 55vw"
                  className="object-cover"
                  priority={i === 0}
                />
              </div>
            ))}
            <p className="pp-gallery__caption">{current.caption}</p>
          </div>
          <div className="pp-gallery__thumbs" role="tablist" aria-label="Photos">
            {gallery.map((shot, i) => (
              <button
                key={shot.src}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={shot.caption}
                className={cn("pp-gallery__thumb", i === active && "is-on")}
                onClick={() => setActive(i)}
              >
                <AscendImage src={shot.src} alt="" fill sizes="120px" className="object-cover" />
              </button>
            ))}
          </div>
        </div>

        <div className="pp-panel">
          <p className="pp-eyebrow">{product.dropName}</p>
          <h2 className="pp-panel__title">{product.name}</h2>
          <p className="pp-panel__price">{product.price.display}</p>
          <p className="pp-panel__standard">{art.standard}</p>

          <SizePicker sizes={product.sizes ?? []} purchase={purchase} />
          <BuyButtons product={product} purchase={purchase} />

          <dl className="pp-spec">
            {print.garment.map((g) => (
              <div key={g.label} className="pp-spec__row">
                <dt>{g.label}</dt>
                <dd>{g.value}</dd>
              </div>
            ))}
            <div className="pp-spec__row">
              <dt>Artwork</dt>
              <dd>
                {art.title} — {print.collab}
              </dd>
            </div>
          </dl>

          <p className="pp-panel__note">
            Returns and exchanges: see our <Link href="/refunds">refund policy</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}

function SceneStory({ print }: { print: DropPrint }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const yA = useTransform(scrollYProgress, [0, 1], ["-8%", "8%"]);
  const yB = useTransform(scrollYProgress, [0, 1], ["10%", "-10%"]);
  const [a, b] = print.portraits;

  return (
    <section ref={ref} id="scene" className="pp-scene" aria-labelledby="pp-scene-title">
      <div className="pp-scene__wide">
        <AscendImage src={print.wide.src} alt={print.wide.alt} fill sizes="100vw" className="object-cover" />
        <div className="pp-scene__wide-shade" aria-hidden />
        <div className="drop-shell pp-scene__wide-copy">
          <p className="pp-eyebrow">The scene</p>
          <h2 id="pp-scene-title" className="pp-scene__title">
            {print.scenario.title}
          </h2>
          {print.scenario.lines.map((l) => (
            <p key={l} className="pp-scene__line">
              {l}
            </p>
          ))}
        </div>
      </div>

      <div className="drop-shell pp-scene__pair">
        <motion.figure className="pp-scene__shot" style={reduce ? undefined : { y: yA }}>
          <div className="pp-scene__frame">
            <AscendImage src={a!.src} alt={a!.alt} fill sizes="(max-width: 899px) 100vw, 45vw" className="object-cover" />
          </div>
          <figcaption>{a!.caption}</figcaption>
        </motion.figure>
        <motion.figure className="pp-scene__shot pp-scene__shot--offset" style={reduce ? undefined : { y: yB }}>
          <div className="pp-scene__frame">
            <AscendImage src={b!.src} alt={b!.alt} fill sizes="(max-width: 899px) 100vw, 45vw" className="object-cover" />
          </div>
          <figcaption>{b!.caption}</figcaption>
        </motion.figure>
      </div>
    </section>
  );
}

function ArtworkAndStandard({ print }: { print: DropPrint }) {
  const art = print.artwork;
  const reduce = useReducedMotion();
  const reveal = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 24 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, amount: 0.3 },
        transition: { duration: 0.9, ease: EASE },
      };

  return (
    <section className="pp-art" aria-labelledby="pp-art-title">
      <div className="drop-shell pp-art__grid">
        <motion.figure className="pp-art__piece" {...reveal}>
          <div className="pp-art__frame" style={{ aspectRatio: String(art.ratio) }}>
            <AscendImage src={art.image} alt={art.alt} fill sizes="(max-width: 899px) 100vw, 45vw" className="object-contain" />
          </div>
          <figcaption>
            Original artwork · Print {art.number} · {print.collab}
          </figcaption>
        </motion.figure>

        <motion.div className="pp-art__copy" {...reveal}>
          <p className="pp-eyebrow">The standard · {art.pillar}</p>
          <h2 id="pp-art-title" className="pp-art__title">
            {art.standard}
          </h2>
          <p className="pp-art__body">{art.body.join(" ")}</p>
          <blockquote className="pp-art__quote">
            “{art.quote}”
            <cite>
              {art.journal.kicker} · {art.journal.label}
            </cite>
          </blockquote>
          <div className="pp-art__links">
            <Link href={art.journal.href} className="pp-link">
              <span>{art.journal.kicker}</span>
              <em>
                Read “{art.journal.label}” <b aria-hidden>→</b>
              </em>
            </Link>
            <Link href={art.philosophy.href} className="pp-link">
              <span>{art.philosophy.kicker}</span>
              <em>
                The {art.philosophy.label} standard <b aria-hidden>→</b>
              </em>
            </Link>
            <Link href={print.collabHref} className="pp-link">
              <span>The drop</span>
              <em>
                {print.collab} <b aria-hidden>→</b>
              </em>
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function OtherPrints({ product }: { product: Drop }) {
  const others = getCollabTees().filter((t) => t.slug !== product.slug);
  return (
    <section className="pp-more" aria-labelledby="pp-more-title">
      <div className="drop-shell">
        <p className="pp-eyebrow">Same drop</p>
        <h2 id="pp-more-title" className="pp-more__title">
          The other prints
        </h2>
        <ul className="pp-more__grid">
          {others.map((t) => (
            <li key={t.slug}>
              <Link
                href={BRAND_ROUTES.drop(t.slug)}
                className="pp-more__card group"
                style={{ "--pt-tone": t.print!.theme.tone } as CSSProperties}
              >
                <span className="pp-more__media">
                  <AscendImage
                    src={t.print!.portraits[0]!.src}
                    alt={t.print!.portraits[0]!.alt}
                    fill
                    sizes="(max-width: 640px) 50vw, 30vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                </span>
                <span className="pp-more__meta">
                  <span className="pp-more__no">{t.print!.artwork.number}</span>
                  <span className="pp-more__name">{t.name}</span>
                  <span className="pp-more__price">{t.price.display}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-10">
          <SocialLinks />
        </div>
        <PageExploreLinks />
      </div>
    </section>
  );
}

function StickyBuy({ product, purchase }: { product: Drop; purchase: Purchase }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("drop-hero");
    const buy = document.getElementById("buy");
    if (!hero || !buy) return;
    let heroOut = false;
    let buyIn = false;
    const update = () => setVisible(heroOut && !buyIn);
    const o1 = new IntersectionObserver(([e]) => {
      heroOut = !e?.isIntersecting;
      update();
    });
    const o2 = new IntersectionObserver(([e]) => {
      buyIn = Boolean(e?.isIntersecting);
      update();
    }, { threshold: 0.25 });
    o1.observe(hero);
    o2.observe(buy);
    return () => {
      o1.disconnect();
      o2.disconnect();
    };
  }, []);

  return (
    <aside className={cn("pp-sticky", visible && "is-on")} aria-label="Purchase" aria-hidden={!visible}>
      <div className="pp-sticky__inner">
        <div className="pp-sticky__meta">
          <p className="pp-sticky__name">{product.name}</p>
          <p className="pp-sticky__price">
            {product.price.display}
            {purchase.size ? ` · Size ${purchase.size}` : ""}
          </p>
        </div>
        <SizePicker sizes={product.sizes ?? []} purchase={purchase} compact />
        <button type="button" className="pp-btn pp-btn--primary" tabIndex={visible ? 0 : -1} onClick={purchase.buyNow}>
          Buy now
        </button>
      </div>
    </aside>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export function PrintProductExperience({ product }: { product: Drop }) {
  const print = product.print!;
  const purchase = usePurchase(product);

  const themeVars = {
    "--pt-tone": print.theme.tone,
    "--pt-ground": print.theme.ground,
    "--pt-second": print.theme.second,
  } as CSSProperties;

  return (
    <div className="pp-canvas drop-canvas" style={themeVars} data-print={print.artwork.id}>
      <BrandNav />
      <Hero product={product} print={print} />
      <BuySection product={product} print={print} purchase={purchase} />
      <SceneStory print={print} />
      <ArtworkAndStandard print={print} />
      <OtherPrints product={product} />
      <StickyBuy product={product} purchase={purchase} />
    </div>
  );
}
