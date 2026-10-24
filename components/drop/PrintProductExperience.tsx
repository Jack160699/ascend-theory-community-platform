"use client";

import { AscendImage } from "@/components/AscendImage";
import { BrandNav } from "@/components/brand/BrandNav";
import { PageExploreLinks } from "@/components/brand/PageExploreLinks";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { useCart } from "@/contexts/cart";
import { BRAND_ROUTES } from "@/lib/brand/routes";
import { getCollabTees, type Drop, type DropPrint, type DropShot } from "@/lib/data/drops";
import { fitOptions, inFit } from "@/lib/drop/fits";
import { cn } from "@/lib/utils";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const EASE = [0.33, 1, 0.68, 1] as const;

/* ───────────────────────── Purchase state ───────────────────────── */

type Variant = NonNullable<Drop["variants"]>[number];

/** Colours and sizes come from the admin catalogue — only active, available variants are sellable. */
export function usePurchase(product: Drop) {
  const { addProduct } = useCart();
  const router = useRouter();
  const variants = useMemo<Variant[]>(
    () =>
      (product.variants ?? [])
        .filter((v) => v.isActive && v.availabilityStatus === "available" && v.stockQuantity > 0)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [product.variants],
  );
  // Several fits (classic crew, heavyweight, terry oversized…) → pick the fit first; colours and sizes follow it.
  const fits = useMemo(() => fitOptions(variants, product.studio?.fits), [variants, product.studio?.fits]);
  const [fit, setFit] = useState<string | null>(() => fits[0]?.key ?? null);
  const fitVariants = useMemo(() => inFit(variants, fits.length ? fit : null), [variants, fits.length, fit]);

  const colours = useMemo(() => {
    const seen = new Map<string, string>();
    fitVariants.forEach((v) => {
      if (!seen.has(v.color)) seen.set(v.color, v.colorDisplay || v.color);
    });
    return Array.from(seen, ([key, label]) => ({ key, label }));
  }, [fitVariants]);
  const allSizes = useMemo(() => Array.from(new Set(fitVariants.map((v) => v.size))), [fitVariants]);

  const [colour, setColour] = useState<string>(() => colours[0]?.key ?? "");
  const [size, setSize] = useState<string | null>(null);
  const [needsSize, setNeedsSize] = useState(false);
  const [added, setAdded] = useState(false);

  const sizesInColour = useMemo(
    () => new Set(fitVariants.filter((v) => v.color === colour).map((v) => v.size)),
    [fitVariants, colour],
  );
  const selected = fitVariants.find((v) => v.color === colour && v.size === size);

  const pickColour = useCallback(
    (c: string) => {
      setColour(c);
      if (size && !fitVariants.some((v) => v.color === c && v.size === size)) setSize(null);
    },
    [size, fitVariants],
  );

  const pickFit = useCallback(
    (key: string) => {
      const next = variants.filter((v) => v.style === key);
      if (!next.length) return;
      setFit(key);
      const keepColour = next.some((v) => v.color === colour) ? colour : next[0]!.color;
      setColour(keepColour);
      if (size && !next.some((v) => v.color === keepColour && v.size === size)) setSize(null);
    },
    [variants, colour, size],
  );
  const currentFit = fits.find((f) => f.key === fit);
  const pricePaise = selected?.pricePaise ?? currentFit?.pricePaise ?? null;

  const pick = useCallback((s: string) => {
    setSize(s);
    setNeedsSize(false);
  }, []);

  const ensureVariant = useCallback((): Variant | null => {
    if (selected) return selected;
    setNeedsSize(true);
    document.getElementById("buy")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return null;
  }, [selected]);

  const add = useCallback(
    (v: Variant, openDrawer: boolean) => {
      const currency = product.price.currency;
      addProduct({
        slug: product.slug,
        variantId: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        quantity: 1,
        title: fits.length && v.styleLabel ? `${product.name} · ${v.styleLabel}` : product.name,
        image: product.print?.portraits[0]?.src ?? product.image,
        priceDisplay: new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(v.pricePaise / 100),
        currency,
        pricePaise: v.pricePaise,
        openDrawer,
      });
    },
    [addProduct, product, fits.length],
  );

  const addToCart = useCallback(() => {
    const v = ensureVariant();
    if (!v) return;
    add(v, true);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1400);
  }, [add, ensureVariant]);

  const buyNow = useCallback(() => {
    const v = ensureVariant();
    if (!v) return;
    add(v, false);
    // Let the cart persist before the checkout page reads it.
    window.setTimeout(() => router.push(BRAND_ROUTES.checkout), 120);
  }, [add, ensureVariant, router]);

  return {
    soldOut: variants.length === 0,
    fits,
    fit,
    pickFit,
    pricePaise,
    colours,
    colour,
    pickColour,
    allSizes,
    sizesInColour,
    size,
    pick,
    needsSize,
    added,
    addToCart,
    buyNow,
  };
}

export type Purchase = ReturnType<typeof usePurchase>;

function ColourPicker({ purchase }: { purchase: Purchase }) {
  if (purchase.colours.length < 2) return null;
  const current = purchase.colours.find((c) => c.key === purchase.colour);
  return (
    <fieldset className="pp-sizes pp-colours">
      <legend className="pp-sizes__legend">
        Colour{current ? <b> · {current.label}</b> : null}
      </legend>
      <div className="pp-colours__row" role="radiogroup" aria-label="Colour">
        {purchase.colours.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={purchase.colour === c.key}
            className={cn("pp-colour", purchase.colour === c.key && "is-on")}
            onClick={() => purchase.pickColour(c.key)}
          >
            <span className="pp-colour__chip" data-colour={c.key.toLowerCase()} aria-hidden />
            {c.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SizePicker({ purchase, compact }: { purchase: Purchase; compact?: boolean }) {
  return (
    <fieldset className={cn("pp-sizes", compact && "pp-sizes--compact", purchase.needsSize && "pp-sizes--alert")}>
      <legend className="pp-sizes__legend">
        Size{purchase.size ? <b> · {purchase.size}</b> : null}
        {purchase.needsSize ? <span className="pp-sizes__hint">Choose a size</span> : null}
      </legend>
      <div className="pp-sizes__row" role="radiogroup" aria-label="Size">
        {purchase.allSizes.map((s) => {
          const available = purchase.sizesInColour.has(s);
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={purchase.size === s}
              disabled={!available}
              title={available ? undefined : "Not available in this colour"}
              className={cn("pp-size", purchase.size === s && "is-on")}
              onClick={() => purchase.pick(s)}
            >
              {s}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function BuyButtons({ product, purchase }: { product: Drop; purchase: Purchase }) {
  if (purchase.soldOut) {
    return (
      <div className="pp-buy__actions">
        <button type="button" className="pp-btn" disabled>
          Sold out
        </button>
      </div>
    );
  }
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

          <ColourPicker purchase={purchase} />
          <SizePicker purchase={purchase} />
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
        <SizePicker purchase={purchase} compact />
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
