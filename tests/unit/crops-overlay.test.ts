import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { drawBoundingBox } from '../../src/crops/overlay.js';

/** Build a solid white PNG buffer of the given size. */
async function whitePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
}

/** Read the RGB triple at (x, y) of a PNG buffer. */
async function pixelAt(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * info.channels;
  return [data[idx]!, data[idx + 1]!, data[idx + 2]!];
}

test('drawBoundingBox: draws a colored rectangle on the rectangle edge, leaves the interior untouched', async () => {
  const img = await whitePng(200, 200);
  const out = await drawBoundingBox(img, { x: 50, y: 50, width: 100, height: 100 }, {
    color: '#ff0000',
    width: 4,
  });

  // A pixel on the top edge of the box should be red-ish.
  const [er, eg, eb] = await pixelAt(out, 100, 50);
  expect(er).toBeGreaterThan(180);
  expect(eg).toBeLessThan(80);
  expect(eb).toBeLessThan(80);

  // A pixel deep in the interior should remain white (box is unfilled).
  const [ir, ig, ib] = await pixelAt(out, 100, 100);
  expect(ir).toBeGreaterThan(200);
  expect(ig).toBeGreaterThan(200);
  expect(ib).toBeGreaterThan(200);
});

test('drawBoundingBox: output dimensions match the input image', async () => {
  const img = await whitePng(120, 90);
  const out = await drawBoundingBox(img, { x: 10, y: 10, width: 40, height: 30 });
  const meta = await sharp(out).metadata();
  expect(meta.width).toBe(120);
  expect(meta.height).toBe(90);
});
