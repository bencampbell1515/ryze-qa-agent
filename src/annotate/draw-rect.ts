import { drawBoundingBox, type BoundingBox } from '../crops/overlay.js';

export type { BoundingBox };

/**
 * Draw a red rectangle around the given bounding box on a full-page screenshot,
 * expanding the box outward by `padding` on all sides. Returns the annotated
 * image as a Buffer.
 *
 * Thin wrapper over the shared {@link drawBoundingBox} overlay primitive in
 * src/crops/overlay.ts — kept so existing callers expecting the padded,
 * red, 4px-stroke style don't have to inline that themselves. The crop pipeline
 * (src/crops/capture.ts) uses drawBoundingBox directly with its own styling.
 */
export async function annotateScreenshot(
  pageScreenshotBuffer: Buffer,
  box: BoundingBox,
  padding = 20,
): Promise<Buffer> {
  return drawBoundingBox(
    pageScreenshotBuffer,
    {
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + padding * 2,
      height: box.height + padding * 2,
    },
    { color: 'red', width: 4 },
  );
}
