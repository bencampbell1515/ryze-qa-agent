import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findFullPageShot, urlToSlug, getCroppedScreenshot, getCroppedScreenshotForFinding } from '../../src/report/screenshot-cropper.js';
import type { Finding } from '../../src/types/finding.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1', fingerprint: 'fp-1', runId: 'r-1', discoveredAt: '2026-05-29T00:00:00.000Z',
    ruleId: 'content:broken-image', category: 'content', source: 'deterministic', severity: 'high',
    url: 'https://www.ryzesuperfoods.com/products/x', title: 'Broken image',
    description: 'desc', confidence: 0.9, ...overrides,
  };
}

test('urlToSlug strips protocol and replaces slashes', () => {
  expect(urlToSlug('https://www.ryzesuperfoods.com/products/mushroom-coffee'))
    .toBe('-products-mushroom-coffee');
});

test('urlToSlug truncates at 60 chars', () => {
  const longPath = '/products/' + 'a'.repeat(80);
  const slug = urlToSlug('https://www.ryzesuperfoods.com' + longPath);
  expect(slug.length).toBeLessThanOrEqual(60);
});

test('findFullPageShot returns null when no screenshots exist', () => {
  const result = findFullPageShot(
    ['https://www.ryzesuperfoods.com/products/does-not-exist'],
    '/tmp/nonexistent-screenshots-dir',
  );
  expect(result).toBeNull();
});

test('getCroppedScreenshot prefers the Tier-1 element crop when elementShot exists', async () => {
  // A tight element crop on disk (what worktree-H checks now produce) must be
  // used directly, NOT the top-350px hero-slice fallback.
  const dir = mkdtempSync(join(tmpdir(), 'ryze-cropper-'));
  const shot = join(dir, 'crop.png');
  await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toFile(shot);

  const bug: any = {
    elementShot: shot,
    urls: ['https://www.ryzesuperfoods.com/products/x'],
    viewports: ['mobile'],
  };
  const res = await getCroppedScreenshot(bug);
  expect(res).not.toBeNull();
  expect(res!.tier).toBe('element');
  expect(res!.viewport).toBe('mobile');
  expect(res!.dataUri.startsWith('data:image/png;base64,')).toBe(true);
});

test('getCroppedScreenshotForFinding uses crop.path resolved under the crops dir', async () => {
  const cropsDir = mkdtempSync(join(tmpdir(), 'ryze-crops-'));
  // Finding.crop.path is relative to output/crops/, e.g. "<runId>/<findingId>.png".
  const rel = 'r-1/f-1.png';
  const abs = join(cropsDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  await sharp({ create: { width: 200, height: 120, channels: 3, background: { r: 5, g: 5, b: 5 } } })
    .png()
    .toFile(abs);

  const finding = makeFinding({
    viewport: 'tablet',
    crop: { path: rel, width: 200, height: 120, padding: 8, boundingBoxDrawn: true },
  });
  const res = await getCroppedScreenshotForFinding(finding, cropsDir);
  expect(res).not.toBeNull();
  expect(res!.tier).toBe('element');
  expect(res!.viewport).toBe('tablet');
  expect(res!.dataUri.startsWith('data:image/png;base64,')).toBe(true);
});

test('getCroppedScreenshotForFinding falls back to fullPageScreenshotPath when no crop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-crops-'));
  const full = join(dir, 'full.png');
  await sharp({ create: { width: 300, height: 600, channels: 3, background: { r: 9, g: 9, b: 9 } } })
    .png()
    .toFile(full);

  const finding = makeFinding({ fullPageScreenshotPath: full });
  const res = await getCroppedScreenshotForFinding(finding);
  expect(res).not.toBeNull();
  expect(res!.tier).toBe('full');
});

test('getCroppedScreenshotForFinding returns null when finding carries no evidence', async () => {
  const finding = makeFinding();
  const res = await getCroppedScreenshotForFinding(finding, '/tmp/ryze-crops-none-xyz');
  expect(res).toBeNull();
});

test('getCroppedScreenshotForFinding returns null when crop.path file is missing', async () => {
  const finding = makeFinding({
    crop: { path: 'r-1/missing.png', width: 10, height: 10, padding: 0, boundingBoxDrawn: false },
  });
  const res = await getCroppedScreenshotForFinding(finding, '/tmp/ryze-crops-none-xyz');
  expect(res).toBeNull();
});
