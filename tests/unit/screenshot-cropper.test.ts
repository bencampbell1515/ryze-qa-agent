import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findFullPageShot, urlToSlug, getCroppedScreenshot } from '../../src/report/screenshot-cropper.js';

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
