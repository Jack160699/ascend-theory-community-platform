/**
 * Phase 5 — Printable Area & Placement Validator
 * Server-side physical & normalized coordinate validator for garment print placements.
 */

import type { DesignPlacement, PlacementLocation, PrintMethod } from "./design-types";

export const VALID_PLACEMENT_LOCATIONS: PlacementLocation[] = [
  "front",
  "back",
  "left_chest",
  "right_chest",
  "left_sleeve",
  "right_sleeve",
  "neck",
  "custom",
];

export const VALID_PRINT_METHODS: PrintMethod[] = [
  "dtf",
  "dtg",
  "screen_print",
  "embroidery",
  "sublimation",
  "other",
];

export type PlacementValidationResult =
  | { isValid: true }
  | { isValid: false; error: string; errors: string[] };

/**
 * Validates design placement dimensions, normalized coordinates, location, and print method.
 * Optionally checks physical width_mm / height_mm against max printable area dimensions if specified.
 */
export function validateDesignPlacement(
  placement: Partial<DesignPlacement>,
  printableAreaLimits?: { maxWidthMm: number; maxHeightMm: number },
): PlacementValidationResult {
  const errors: string[] = [];

  const location = placement.placementLocation || placement.position;
  if (!location || !VALID_PLACEMENT_LOCATIONS.includes(location as PlacementLocation)) {
    errors.push(`Invalid placement location '${location}'. Valid locations: ${VALID_PLACEMENT_LOCATIONS.join(", ")}.`);
  }

  if (placement.printMethod && !VALID_PRINT_METHODS.includes(placement.printMethod)) {
    errors.push(`Invalid print method '${placement.printMethod}'. Valid methods: ${VALID_PRINT_METHODS.join(", ")}.`);
  }

  const widthMm = placement.widthMm ?? 0;
  const heightMm = placement.heightMm ?? 0;

  if (widthMm <= 0) {
    errors.push("Physical width (width_mm) must be a positive integer greater than 0.");
  }
  if (heightMm <= 0) {
    errors.push("Physical height (height_mm) must be a positive integer greater than 0.");
  }

  if (printableAreaLimits) {
    if (widthMm > printableAreaLimits.maxWidthMm) {
      errors.push(`Physical print width (${widthMm}mm) exceeds maximum printable area width (${printableAreaLimits.maxWidthMm}mm).`);
    }
    if (heightMm > printableAreaLimits.maxHeightMm) {
      errors.push(`Physical print height (${heightMm}mm) exceeds maximum printable area height (${printableAreaLimits.maxHeightMm}mm).`);
    }
  }

  const xNorm = placement.xNormalized ?? 0.5;
  const yNorm = placement.yNormalized ?? 0.5;

  if (xNorm < 0 || xNorm > 1) {
    errors.push(`Normalized X coordinate (${xNorm}) must be between 0.0 and 1.0.`);
  }
  if (yNorm < 0 || yNorm > 1) {
    errors.push(`Normalized Y coordinate (${yNorm}) must be between 0.0 and 1.0.`);
  }

  const scale = placement.scale ?? 1.0;
  if (scale <= 0) {
    errors.push(`Placement scale (${scale}) must be greater than 0.`);
  }

  const rotation = placement.rotationDeg ?? 0;
  if (rotation < -360 || rotation > 360) {
    errors.push(`Placement rotation (${rotation}deg) must be between -360 and 360 degrees.`);
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      error: errors[0],
      errors,
    };
  }

  return { isValid: true };
}
