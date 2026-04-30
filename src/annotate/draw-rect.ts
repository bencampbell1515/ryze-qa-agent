import sharp from 'sharp';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draw a red rectangle around the given bounding box on a full-page screenshot.
 * Returns the annotated image as a Buffer.
 */
export async function annotateScreenshot(
  pageScreenshotBuffer: Buffer,
  box: BoundingBox,
  padding = 20,
): Promise<Buffer> {
  const { width: imgWidth, height: imgHeight } = await sharp(pageScreenshotBuffer).metadata();
  const w = imgWidth ?? 1440;
  const h = imgHeight ?? 900;

  const rx = Math.max(0, box.x - padding);
  const ry = Math.max(0, box.y - padding);
  const rw = Math.min(w - rx, box.width + padding * 2);
  const rh = Math.min(h - ry, box.height + padding * 2);

  const svg = Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}"
            fill="none" stroke="red" stroke-width="4"/>
    </svg>
  `);

  return sharp(pageScreenshotBuffer)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
