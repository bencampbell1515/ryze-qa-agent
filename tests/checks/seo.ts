import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';
import { emitBug, type DualWriteContext } from './_emit.js';

export async function runSeoCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
  ctx?: DualWriteContext,
): Promise<void> {
  const url = page.url();

  const title = await page.title();
  if (!title || title.length < 5) {
    emitBug(bugs, ctx, { ruleId: 'seo:missing-title', severity: 'high', bugClass: 'seo',
      message: `Missing or empty <title> on ${url}`, url, viewport },
      { title: 'Missing or empty page title' });
  }

  const metaDesc = await page.locator('meta[name="description"]').getAttribute('content').catch(() => null);
  if (!metaDesc) {
    emitBug(bugs, ctx, { ruleId: 'seo:missing-meta-description', severity: 'medium', bugClass: 'seo',
      message: `Missing <meta name=description> on ${url}`, url, viewport },
      { title: 'Missing meta description' });
  }

  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href').catch(() => null);
  if (!canonical) {
    emitBug(bugs, ctx, { ruleId: 'seo:missing-canonical', severity: 'high', bugClass: 'seo',
      message: `Missing <link rel=canonical> on ${url}`, url, viewport },
      { title: 'Missing canonical link' });
  }

  const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content').catch(() => null);
  if (!ogTitle) {
    emitBug(bugs, ctx, { ruleId: 'seo:missing-og-title', severity: 'medium', bugClass: 'seo',
      message: `Missing <meta property=og:title> on ${url}`, url, viewport },
      { title: 'Missing og:title tag' });
  }

  // Check for Product JSON-LD on PDPs
  if (url.includes('/products/')) {
    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
    const hasProductSchema = jsonLd.some((s) => {
      try { return JSON.parse(s)['@type'] === 'Product'; } catch { return false; }
    });
    if (!hasProductSchema) {
      emitBug(bugs, ctx, { ruleId: 'seo:missing-product-jsonld', severity: 'high', bugClass: 'seo',
        message: `Missing Product JSON-LD on ${url}`, url, viewport },
        { title: 'Missing Product JSON-LD on product page' });
    }
  }
}
