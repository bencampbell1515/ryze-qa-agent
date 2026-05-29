import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { annotateScreenshot } from '../../src/annotate/draw-rect.js';

async function whitePng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png()
    .toBuffer();
}

async function pixelAt(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * info.channels;
  return [data[idx]!, data[idx + 1]!, data[idx + 2]!];
}

test('annotateScreenshot: draws a red rectangle expanded by padding, preserving image size', async () => {
  const img = await whitePng(300, 300);
  // box at (100,100,80,80); default padding 20 → rect drawn at (80,80) .. (200,200)
  const out = await annotateScreenshot(img, { x: 100, y: 100, width: 80, height: 80 });

  const meta = await sharp(out).metadata();
  expect(meta.width).toBe(300);
  expect(meta.height).toBe(300);

  // Top edge of the padded rectangle sits at y≈80; sample its midpoint.
  const [r, g, b] = await pixelAt(out, 140, 80);
  expect(r).toBeGreaterThan(180);
  expect(g).toBeLessThan(90);
  expect(b).toBeLessThan(90);

  // Interior stays white (unfilled rectangle).
  const [ir, ig, ib] = await pixelAt(out, 140, 140);
  expect(ir).toBeGreaterThan(200);
  expect(ig).toBeGreaterThan(200);
  expect(ib).toBeGreaterThan(200);
});
