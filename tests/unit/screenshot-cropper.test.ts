import { test, expect } from '@playwright/test';
import { findFullPageShot, urlToSlug } from '../../src/report/screenshot-cropper.js';

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
