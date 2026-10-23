"use client";

import { useMemo } from "react";
import type { PlacementLocation } from "@/lib/wearables/design-types";
import { garmentSvg, MOCKUP_CANVAS, MOCKUP_PPI, mockupAnchor, type GarmentShape } from "@/lib/studio/mockup-svg";

/** Live preview: the same garment illustration the published mockup uses, with the artwork placed to scale. */
export function MockupPreview({
  shape,
  colourHex,
  placement,
  artworkUrl,
  widthIn,
  heightIn,
  inkHex,
  className = "",
}: {
  shape: GarmentShape;
  colourHex: string;
  placement: PlacementLocation;
  artworkUrl: string;
  widthIn: number;
  heightIn: number;
  /** Single-colour finishes (puff, metallic, glow) preview in their ink colour. */
  inkHex?: string;
  className?: string;
}) {
  const svg = useMemo(() => garmentSvg(shape, colourHex, placement === "back" ? "back" : "front"), [shape, colourHex, placement]);
  const ppi = MOCKUP_PPI[shape];
  const w = widthIn * ppi;
  const h = heightIn * ppi;
  const { cx, top } = mockupAnchor(shape, placement);
  const box = {
    left: `${((cx - w / 2) / MOCKUP_CANVAS.w) * 100}%`,
    top: `${(top / MOCKUP_CANVAS.h) * 100}%`,
    width: `${(w / MOCKUP_CANVAS.w) * 100}%`,
    height: `${(h / MOCKUP_CANVAS.h) * 100}%`,
  };
  return (
    <div className={`relative w-full overflow-hidden rounded-lg ${className}`} style={{ aspectRatio: `${MOCKUP_CANVAS.w} / ${MOCKUP_CANVAS.h}` }}>
      <div className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      {inkHex ? (
        <div
          role="img"
          aria-label="Design preview"
          className="absolute"
          style={{
            ...box,
            backgroundColor: inkHex,
            maskImage: `url("${artworkUrl}")`,
            WebkitMaskImage: `url("${artworkUrl}")`,
            maskSize: "contain",
            WebkitMaskSize: "contain",
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskPosition: "center",
          }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artworkUrl} alt="Design preview" className="absolute object-contain" style={box} />
      )}
    </div>
  );
}
