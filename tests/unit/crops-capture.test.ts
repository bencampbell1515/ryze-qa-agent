import { test, expect, chromium } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import sharp from 'sharp';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureCrop } from '../../src/crops/capture.js';
import { ElementNotVisibleError } from '../../src/crops/errors.js';

let browser: Browser;
let page: Page;
let outDir: string;

test.beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
test.afterAll(async () => {
  await browser.close();
});
test.beforeEach(async () => {
  // Pin a plain desktop context: deviceScaleFactor 1 and isMobile false so the
  // layout viewport equals the screenshot surface and CSS-px box math maps 1:1
  // to image px. The mobile Playwright project otherwise leaks isMobile:true
  // into newPage(), producing a 980x735 layout viewport scaled into an 800x600
  // screenshot — a scale captureCrop handles in production but which would make
  // these exact-dimension assertions non-deterministic.
  page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  });
  outDir = mkdtempSync(join(tmpdir(), 'ryze-crops-'));
});
test.afterEach(async () => {
  await page.close();
});

async function pixelAt(path: string, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * info.channels;
  return [data[idx]!, data[idx + 1]!, data[idx + 2]!];
}

/**
 * Real-browser screenshots round fractional element bounds (boundingBox can
 * report 199.99998px) against the device surface, so a CSS-pixel crop size is
 * accurate to ±1px, not exact. Assert tight-crop sizing within a small
 * tolerance — the contract is "tight element crop", not "exact pixel count".
 */
function expectClose(actual: number, expected: number, tol = 2): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

test('captureCrop: visible element via locator → crop sized to element box + 2*padding, box drawn', async () => {
  await page.setContent(`<!doctype html><body style="margin:0;background:#fff">
    <div id="t" style="position:absolute;top:200px;left:150px;width:120px;height:60px;background:#0000ff"></div>
  </body>`);
  const out = join(outDir, 'crop.png');
  const crop = await captureCrop(page, { kind: 'locator', locator: page.locator('#t') }, out, {
    paddingPx: 16,
  });

  expect(existsSync(out)).toBe(true);
  expect(crop.path).toBe(out);
  expect(crop.padding).toBe(16);
  expect(crop.boundingBoxDrawn).toBe(true);
  // element 120x60 + 16px padding on all sides ≈ 152 x 92
  expectClose(crop.width, 152);
  expectClose(crop.height, 92);
});

test('captureCrop: padding clamps at the viewport edge (element flush in the top-left corner)', async () => {
  await page.setContent(`<!doctype html><body style="margin:0;background:#fff">
    <div id="t" style="position:absolute;top:0;left:0;width:100px;height:40px;background:#0000ff"></div>
  </body>`);
  const out = join(outDir, 'crop.png');
  const crop = await captureCrop(page, { kind: 'locator', locator: page.locator('#t') }, out, {
    paddingPx: 20,
  });
  // Left/top padding clamps to 0, so width = 100 + 20 (right only), height = 40 + 20 (bottom only)
  expectClose(crop.width, 120);
  expectClose(crop.height, 60);
});

test('captureCrop: drawn bounding box appears at the padded element border', async () => {
  await page.setContent(`<!doctype html><body style="margin:0;background:#ffffff">
    <div id="t" style="position:absolute;top:200px;left:150px;width:120px;height:60px;background:#ffffff;border:0"></div>
  </body>`);
  const out = join(outDir, 'crop.png');
  await captureCrop(page, { kind: 'locator', locator: page.locator('#t') }, out, {
    paddingPx: 16,
    boundingBoxColor: '#ff0000',
    boundingBoxWidth: 4,
  });
  // The box is drawn at the original element bounds, which sit at offset (16,16)
  // within the crop. Sample the top edge of that rectangle.
  const [r, g, b] = await pixelAt(out, 16 + 60, 16);
  expect(r).toBeGreaterThan(180);
  expect(g).toBeLessThan(80);
  expect(b).toBeLessThan(80);
});

test('captureCrop: oversized element scales down to maxDimensions preserving aspect ratio', async () => {
  await page.setContent(`<!doctype html><body style="margin:0;background:#fff">
    <div id="t" style="position:absolute;top:0;left:0;width:800px;height:400px;background:#0000ff"></div>
  </body>`);
  const out = join(outDir, 'crop.png');
  const crop = await captureCrop(page, { kind: 'locator', locator: page.locator('#t') }, out, {
    paddingPx: 0,
    maxDimensions: { width: 400, height: 400 },
  });
  // 800x400 scaled to fit within 400x400 → 400x200 (2:1 aspect preserved)
  expectClose(crop.width, 400);
  expectClose(crop.height, 200);
  // Aspect ratio preserved regardless of the ±1px rounding.
  expect(Math.abs(crop.width / crop.height - 2)).toBeLessThan(0.05);
});

test('captureCrop: below-fold element is scrolled into view and captured (tall page)', async () => {
  await page.setContent(`<!doctype html><body style="margin:0;background:#fff">
    <div style="height:2000px"></div>
    <div id="t" style="width:200px;height:80px;background:#00ff00"></div>
  </body>`);
  const out = join(outDir, 'crop.png');
  const crop = await captureCrop(page, { kind: 'locator', locator: page.locator('#t') }, out, {
    paddingPx: 0,
  });
  expectClose(crop.width, 200);
  expectClose(crop.height, 80);
  // Center pixel should be the green element, proving we captured the right region.
  const [r, g, b] = await pixelAt(out, 100, 40);
  expect(g).toBeGreaterThan(180);
  expect(r).toBeLessThan(80);
  expect(b).toBeLessThan(80);
});

test('captureCrop: invisible element (display:none) throws ElementNotVisibleError', async () => {
  await page.setContent(`<!doctype html><body>
    <div id="t" style="display:none;width:100px;height:100px"></div>
  </body>`);
  const out = join(outDir, 'crop.png');
  await expect(
    captureCrop(page, { kind: 'locator', locator: page.locator('#t') }, out),
  ).rejects.toThrow(ElementNotVisibleError);
  expect(existsSync(out)).toBe(false);
});

test('captureCrop: zero-size element throws ElementNotVisibleError', async () => {
  await page.setContent(`<!doctype html><body>
    <div id="t" style="width:0;height:0"></div>
  </body>`);
  const out = join(outDir, 'crop.png');
  await expect(
    captureCrop(page, { kind: 'locator', locator: page.locator('#t') }, out),
  ).rejects.toThrow(ElementNotVisibleError);
});

test('captureCrop: boundingBox target clips the supplied viewport-relative region', async () => {
  await page.setContent(`<!doctype html><body style="margin:0;background:#fff">
    <div style="position:absolute;top:100px;left:100px;width:120px;height:60px;background:#0000ff"></div>
  </body>`);
  const out = join(outDir, 'crop.png');
  const crop = await captureCrop(
    page,
    { kind: 'boundingBox', box: { x: 100, y: 100, width: 120, height: 60 } },
    out,
    { paddingPx: 0, drawBoundingBox: false },
  );
  expect(crop.boundingBoxDrawn).toBe(false);
  expectClose(crop.width, 120);
  expectClose(crop.height, 60);
  const [r, g, b] = await pixelAt(out, 60, 30);
  expect(b).toBeGreaterThan(180);
  expect(r).toBeLessThan(80);
  expect(g).toBeLessThan(80);
});
