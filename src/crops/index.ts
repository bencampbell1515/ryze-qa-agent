/**
 * Element cropping + bounding-box overlays.
 *
 * `captureCrop` is the primary entry point: given a Playwright page and an
 * element (locator or viewport-relative box), it produces a tight, annotated
 * PNG crop and returns {@link ElementCrop} metadata. v2 Finding-emitting checks
 * (worktrees I/J/K) call it directly.
 */
export { captureCrop } from './capture.js';
export { drawBoundingBox } from './overlay.js';
export type { BoundingBox, OverlayOptions } from './overlay.js';
export { cropPath } from './path.js';
export { ElementNotVisibleError } from './errors.js';
export type { CropConfig, CropTarget } from './types.js';
