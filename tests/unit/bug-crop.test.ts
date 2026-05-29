import { test, expect, chromium } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import sharp from 'sharp';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureBugCrop } from '../../src/crops/bug-crop.js';

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
  page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  });
  outDir = mkdtempSync(join(tmpdir(), 'ryze-bugcrop-'));
});
test.afterEach(async () => {
  await page.close();
});

test('captureBugCrop: visible element → returns a PNG path that exists under outputDir', async () => {
  await page.setContent(`<!doctype html><body style="margin:0">
    <button id="b" style="position:absolute;top:100px;left:100px;width:120px;height:40px">Buy</button>
  </body>`);
  const path = await captureBugCrop(
    page,
    { kind: 'locator', locator: page.locator('#b') },
    { url: 'https://www.ryzesuperfoods.com/products/x', ruleId: 'content:tap-target-too-small', viewport: 'mobile', outputDir: outDir },
  );
  expect(path).not.toBeNull();
  expect(path!.startsWith(outDir)).toBe(true);
  expect(existsSync(path!)).toBe(true);
  const meta = await sharp(path!).metadata();
  expect(meta.format).toBe('png');
  expect((meta.width ?? 0)).toBeGreaterThan(0);
});

test('captureBugCrop: invisible element → returns null (swallows ElementNotVisibleError, no throw)', async () => {
  await page.setContent(`<!doctype html><body>
    <div id="hid" style="display:none;width:100px;height:100px"></div>
  </body>`);
  const path = await captureBugCrop(
    page,
    { kind: 'locator', locator: page.locator('#hid') },
    { url: 'https://www.ryzesuperfoods.com/x', ruleId: 'content:broken-image', viewport: 'desktop', outputDir: outDir },
  );
  expect(path).toBeNull();
});

test('captureBugCrop: seq disambiguates filenames for same url+rule+viewport', async () => {
  await page.setContent(`<!doctype html><body style="margin:0">
    <div id="a" style="position:absolute;top:50px;left:50px;width:80px;height:30px;background:#00f"></div>
    <div id="c" style="position:absolute;top:120px;left:50px;width:80px;height:30px;background:#0f0"></div>
  </body>`);
  const ctx = { url: 'https://www.ryzesuperfoods.com/p', ruleId: 'content:empty-image-src', viewport: 'desktop', outputDir: outDir };
  const p0 = await captureBugCrop(page, { kind: 'locator', locator: page.locator('#a') }, { ...ctx, seq: 0 });
  const p1 = await captureBugCrop(page, { kind: 'locator', locator: page.locator('#c') }, { ...ctx, seq: 1 });
  expect(p0).not.toBeNull();
  expect(p1).not.toBeNull();
  expect(p0).not.toBe(p1);
});
