import type { Locator } from '@playwright/test';

/**
 * Per-crop generation config. Most consumers should accept defaults.
 */
export interface CropConfig {
  /** Padding in CSS pixels around the element bounds. Default 16. */
  paddingPx?: number;
  /** Whether to draw a bounding box overlay on the crop. Default true. */
  drawBoundingBox?: boolean;
  /** Bounding box color (CSS color string). Default "#ff3b3b". */
  boundingBoxColor?: string;
  /** Bounding box stroke width in pixels. Default 3. */
  boundingBoxWidth?: number;
  /** Output PNG compression level (0-9, sharp default is fine). */
  quality?: number;
  /** Max crop dimensions (width x height) in pixels. Default 1600x1200.
   *  Crops larger than this are scaled down preserving aspect ratio. */
  maxDimensions?: { width: number; height: number };
}

/**
 * A locator for the element to crop. Either a Playwright Locator (preferred —
 * the capturer scrolls it into view) or an explicit viewport-relative bounding
 * box (when the caller already computed it and the element is in view).
 */
export type CropTarget =
  | { kind: 'locator'; locator: Locator }
  | { kind: 'boundingBox'; box: { x: number; y: number; width: number; height: number } };
