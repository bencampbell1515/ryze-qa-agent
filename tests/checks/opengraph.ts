import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

/**
 * Verifies Open Graph meta tags for completeness and correctness.
 *
 * For every page, checks that these tags exist with non-empty content:
 *   og:title, og:description, og:image, og:url, og:type
 *   → seo:og-missing (medium) for each missing/empty tag.
 *
 * For PDPs (URL contains /products/):
 *   og:type value must contain "product" (case-insensitive)
 *   → seo:og-wrong-type (medium) if it doesn't.
 */

const REQUIRED_OG_TAGS = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'] as const;

export async function runOpenGraphCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  const url = page.url();
  const isProductPage = url.includes('/products/');

  for (const property of REQUIRED_OG_TAGS) {
    const count = await page.locator(`meta[property="${property}"]`).count();
    let content: string | null = null;
    if (count > 0) {
      content = await page
        .locator(`meta[property="${property}"]`)
        .first()
        .getAttribute('content')
        .catch(() => null);
    }

    if (content === null || content.trim() === '') {
      bugs.add({
        ruleId: 'seo:og-missing',
        severity: 'medium',
        bugClass: 'seo',
        message: `Missing or empty ${property}`,
        url,
        viewport,
      });
    }
  }

  // PDP-specific: verify og:type is product-related
  if (isProductPage) {
    const ogTypeCount = await page.locator('meta[property="og:type"]').count();
    let ogType: string | null = null;
    if (ogTypeCount > 0) {
      ogType = await page
        .locator('meta[property="og:type"]')
        .first()
        .getAttribute('content')
        .catch(() => null);
    }

    if (ogType !== null && ogType.trim() !== '' && !/product/i.test(ogType)) {
      bugs.add({
        ruleId: 'seo:og-wrong-type',
        severity: 'medium',
        bugClass: 'seo',
        message: `og:type is "${ogType}" on a PDP — expected a value containing "product" (e.g., "product" or "og:product")`,
        url,
        viewport,
      });
    }
  }
}
