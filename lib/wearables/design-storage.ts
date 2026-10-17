/**
 * Phase 5 — Design Storage & Artwork Security Abstraction
 * Handles artwork upload validation, allowed MIME types, and private storage key resolution.
 */

export const ALLOWED_ARTWORK_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

export const MAX_ARTWORK_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB max

export type ArtworkValidationResult =
  | { isValid: true }
  | { isValid: false; error: string };

export function validateArtworkUpload(input: {
  mimeType: string;
  fileSizeBytes: number;
  originalFilename?: string;
}): ArtworkValidationResult {
  if (!input.mimeType || !ALLOWED_ARTWORK_MIME_TYPES.includes(input.mimeType.toLowerCase())) {
    return {
      isValid: false,
      error: `Invalid artwork format '${input.mimeType}'. Allowed formats: PNG, JPG/JPEG, WEBP, SVG.`,
    };
  }

  if (input.fileSizeBytes <= 0) {
    return {
      isValid: false,
      error: "Artwork file size must be greater than 0 bytes.",
    };
  }

  if (input.fileSizeBytes > MAX_ARTWORK_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      error: `Artwork file size exceeds maximum limit of 25MB (${(input.fileSizeBytes / (1024 * 1024)).toFixed(1)}MB provided).`,
    };
  }

  return { isValid: true };
}

/**
 * Returns private storage path reference for a design artwork asset.
 */
export function buildPrivateDesignStoragePath(designId: string, filename: string): string {
  const sanitizeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `private/artwork/${designId}/${sanitizeName}`;
}
