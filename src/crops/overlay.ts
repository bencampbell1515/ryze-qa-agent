import sharp from 'sharp';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayOptions {
  /** Stroke color (CSS color string). Default "#ff3b3b". */
  color?: string;
  /** Stroke width in pixels. Default 3. */
  width?: number;
}

const DEFAULT_COLOR = '#ff3b3b';
const DEFAULT_WIDTH = 3;

/**
 * Draw an unfilled rectangle on top of a PNG image at the given pixel
 * coordinates and return the composited PNG buffer. The box is clamped to the
 * image bounds. This is the single overlay primitive shared by the crop
 * capturer and the legacy full-page annotator (src/annotate/draw-rect.ts).
 */
export async function drawBoundingBox(
  imageBuffer: Buffer,
  box: BoundingBox,
  options: OverlayOptions = {},
): Promise<Buffer> {
  const color = options.color ?? DEFAULT_COLOR;
  const stroke = options.width ?? DEFAULT_WIDTH;

  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? Math.ceil(box.x + box.width);
  const imgH = meta.height ?? Math.ceil(box.y + box.height);

  // Clamp the rectangle to the image so the SVG never references off-canvas px.
  const rx = Math.max(0, box.x);
  const ry = Math.max(0, box.y);
  const rw = Math.min(imgW - rx, box.width);
  const rh = Math.min(imgH - ry, box.height);

  const svg = Buffer.from(
    `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" ` +
      `fill="none" stroke="${color}" stroke-width="${stroke}"/>` +
      `</svg>`,
  );

  return sharp(imageBuffer)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
