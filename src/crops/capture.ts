import type { Page } from '@playwright/test';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ElementCrop } from '../types/finding.js';
import type { CropConfig, CropTarget } from './types.js';
import { drawBoundingBox } from './overlay.js';
import { ElementNotVisibleError } from './errors.js';

const DEFAULT_PADDING = 16;
const DEFAULT_BOX_COLOR = '#ff3b3b';
const DEFAULT_BOX_WIDTH = 3;
const DEFAULT_MAX_DIMENSIONS = { width: 1600, height: 1200 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Capture a cropped, annotated screenshot of the target element.
 *
 * The page must already be at the right URL and viewport; this function does
 * not navigate. For a `locator` target it scrolls the element into view before
 * measuring, so below-the-fold elements work.
 *
 * Coordinates are scale-aware: element bounds come back in CSS/layout pixels
 * (`getBoundingClientRect` space) but the screenshot may be rendered at a
 * different pixel scale — device-scale-factor > 1 (retina), or a mobile-emulated
 * layout viewport that differs from the captured surface. We derive the scale
 * from `screenshotWidth / window.innerWidth` and map layout px → image px, so
 * the crop is correct under any DSF or emulation rather than assuming DSF 1.
 *
 * Throws {@link ElementNotVisibleError} for an invisible or zero-area target —
 * it never falls back to a full-page screenshot.
 */
export async function captureCrop(
  page: Page,
  target: CropTarget,
  outputPath: string,
  config: CropConfig = {},
): Promise<ElementCrop> {
  const paddingPx = config.paddingPx ?? DEFAULT_PADDING;
  const drawBox = config.drawBoundingBox ?? true;
  const maxDims = config.maxDimensions ?? DEFAULT_MAX_DIMENSIONS;

  // 1. Resolve the target to a layout-relative bounding box (CSS pixels), and
  //    for locators scroll it fully inside the viewport.
  const box = await resolveBox(page, target);

  // 2. Capture the current viewport (not the full page) and crop with sharp.
  //    We deliberately do NOT use page.screenshot({ clip }): a fractional box at
  //    a scrolled page edge makes the clip spill ~1px past the rendered surface
  //    and Playwright throws "Clipped area … outside the resulting image".
  //    Cropping the buffer ourselves lets us clamp to the ACTUAL pixel size.
  const base = sharp(await page.screenshot());
  const meta = await base.metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  // 3. Map layout px → image px. innerWidth/innerHeight describe the layout
  //    viewport the box was measured against; the screenshot may be a scaled
  //    rendering of it (retina DSF, mobile emulation). scaleX/scaleY are 1 in
  //    the common desktop case.
  const layout = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const scaleX = layout.w > 0 ? imgW / layout.w : 1;
  const scaleY = layout.h > 0 ? imgH / layout.h : 1;

  const ix = box.x * scaleX;
  const iy = box.y * scaleY;
  const iw = box.width * scaleX;
  const ih = box.height * scaleY;
  const ipadX = paddingPx * scaleX;
  const ipadY = paddingPx * scaleY;

  // 4. Expand by padding and clamp to the captured image bounds. x0/y0 are
  //    clamped to imgW-1/imgH-1 so the extract origin is always a valid pixel
  //    even if the element ended up off-screen.
  const x0 = clamp(Math.round(ix - ipadX), 0, Math.max(0, imgW - 1));
  const y0 = clamp(Math.round(iy - ipadY), 0, Math.max(0, imgH - 1));
  const x1 = clamp(Math.round(ix + iw + ipadX), 0, imgW);
  const y1 = clamp(Math.round(iy + ih + ipadY), 0, imgH);
  const cropW = Math.max(1, Math.min(x1 - x0, imgW - x0));
  const cropH = Math.max(1, Math.min(y1 - y0, imgH - y0));

  let buffer = await base
    .extract({ left: x0, top: y0, width: cropW, height: cropH })
    .png()
    .toBuffer();

  // 5. Draw the box at the ORIGINAL (un-padded) element bounds, in crop-relative
  //    image coordinates. Done before any scale-down so it scales with the image.
  if (drawBox) {
    buffer = await drawBoundingBox(
      buffer,
      { x: ix - x0, y: iy - y0, width: iw, height: ih },
      { color: config.boundingBoxColor ?? DEFAULT_BOX_COLOR, width: config.boundingBoxWidth ?? DEFAULT_BOX_WIDTH },
    );
  }

  // 6. Scale down if the crop exceeds maxDimensions, preserving aspect ratio.
  if (cropW > maxDims.width || cropH > maxDims.height) {
    buffer = await sharp(buffer)
      .resize({ width: maxDims.width, height: maxDims.height, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  }

  // 7. Write to disk and return metadata reflecting the actual PNG.
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  const finalMeta = await sharp(buffer).metadata();

  return {
    path: outputPath,
    width: finalMeta.width ?? cropW,
    height: finalMeta.height ?? cropH,
    padding: paddingPx,
    boundingBoxDrawn: drawBox,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function resolveBox(page: Page, target: CropTarget): Promise<Box> {
  if (target.kind === 'boundingBox') {
    const b = target.box;
    if (b.width <= 0 || b.height <= 0) {
      throw new ElementNotVisibleError(`boundingBox ${JSON.stringify(b)}`);
    }
    return b;
  }

  // locator target — scroll into view, then measure.
  const { locator } = target;
  const desc = describeLocator(locator);

  await locator.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
  let b = await locator.boundingBox().catch(() => null);
  if (!b || b.width <= 0 || b.height <= 0) {
    throw new ElementNotVisibleError(desc);
  }

  // scrollIntoViewIfNeeded scrolls the *minimal* amount and is non-deterministic
  // — it can leave the element straddling or below the viewport bottom, so a
  // viewport-clipped screenshot would miss it. Scroll by an exact delta to bring
  // the element fully inside the layout viewport, then re-measure. innerHeight is
  // the layout viewport (matches boundingBox's coordinate space); a few attempts
  // cover layout shift under load; the browser clamps at page edges.
  const layoutH = await page.evaluate(() => window.innerHeight).catch(() => 0);
  for (let i = 0; layoutH > 0 && i < 3 && (b.y < 0 || b.y + b.height > layoutH); i++) {
    const targetTop = Math.max(0, (layoutH - b.height) / 2);
    await page.evaluate((dy) => window.scrollBy(0, dy), b.y - targetTop).catch(() => {});
    const next = await locator.boundingBox().catch(() => null);
    if (!next || next.width <= 0 || next.height <= 0) break;
    b = next;
  }
  return b;
}

function describeLocator(locator: { toString(): string }): string {
  // Locator.toString() yields e.g. `locator('#t')` — good enough for the error.
  return locator.toString();
}
