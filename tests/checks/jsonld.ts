import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';
import { emitBug, type DualWriteContext } from './_emit.js';

/**
 * Validates <script type="application/ld+json"> blocks for structural correctness.
 *
 * For every JSON-LD block:
 *   1. Parse as JSON — flag seo:jsonld-malformed (high) on failure.
 *   2. Verify @context contains "schema.org" — flag seo:jsonld-missing-context (medium).
 *
 * For PDPs (URL contains /products/) only:
 *   3. Expect a block with @type === "Product" (or array including "Product").
 *      On the Product block, verify: name, image, offers.price, offers.priceCurrency.
 *      Each missing/empty field → seo:jsonld-product-incomplete (high).
 *
 * Visibility filter: not applicable — JSON-LD is in <head>.
 */
export async function runJsonLdCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
  ctx?: DualWriteContext,
): Promise<void> {
  const url = page.url();
  const isProductPage = url.includes('/products/');

  const rawBlocks = await page.locator('script[type="application/ld+json"]').allTextContents();

  // Track whether we found a valid Product schema on PDPs
  let foundProductSchema = false;

  for (const raw of rawBlocks) {
    // 1. Parse JSON
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      emitBug(bugs, ctx, {
        ruleId: 'seo:jsonld-malformed',
        severity: 'high',
        bugClass: 'seo',
        message: `JSON-LD block failed to parse: ${raw.slice(0, 100)}`,
        url,
        viewport,
      }, { title: 'JSON-LD block failed to parse' });
      continue;
    }

    // 2. Verify @context contains "schema.org"
    const context = parsed['@context'];
    if (!context || !String(context).includes('schema.org')) {
      emitBug(bugs, ctx, {
        ruleId: 'seo:jsonld-missing-context',
        severity: 'medium',
        bugClass: 'seo',
        message: `JSON-LD block is missing @context with "schema.org"`,
        url,
        viewport,
      }, { title: 'JSON-LD missing schema.org @context' });
    }

    // 3. PDP-specific: Product schema validation
    if (isProductPage) {
      const type = parsed['@type'];
      const isProduct =
        type === 'Product' ||
        (Array.isArray(type) && type.includes('Product'));

      if (isProduct) {
        foundProductSchema = true;

        // Check required fields
        const name = parsed['name'];
        if (!name || (typeof name === 'string' && name.trim() === '')) {
          emitBug(bugs, ctx, {
            ruleId: 'seo:jsonld-product-incomplete',
            severity: 'high',
            bugClass: 'seo',
            message: `Product JSON-LD missing/empty: name`,
            url,
            viewport,
          }, { title: 'Product JSON-LD missing name' });
        }

        const image = parsed['image'];
        const imageEmpty =
          !image ||
          (typeof image === 'string' && image.trim() === '') ||
          (Array.isArray(image) && image.length === 0);
        if (imageEmpty) {
          emitBug(bugs, ctx, {
            ruleId: 'seo:jsonld-product-incomplete',
            severity: 'high',
            bugClass: 'seo',
            message: `Product JSON-LD missing/empty: image`,
            url,
            viewport,
          }, { title: 'Product JSON-LD missing image' });
        }

        const offers = parsed['offers'] as Record<string, unknown> | undefined;
        if (!offers || typeof offers !== 'object') {
          emitBug(bugs, ctx, {
            ruleId: 'seo:jsonld-product-incomplete',
            severity: 'high',
            bugClass: 'seo',
            message: `Product JSON-LD missing/empty: offers`,
            url,
            viewport,
          }, { title: 'Product JSON-LD missing offers' });
        } else {
          const price = offers['price'];
          const priceNum = parseFloat(String(price ?? ''));
          if (price === undefined || price === null || price === '' || isNaN(priceNum) || priceNum <= 0) {
            emitBug(bugs, ctx, {
              ruleId: 'seo:jsonld-product-incomplete',
              severity: 'high',
              bugClass: 'seo',
              message: `Product JSON-LD missing/empty: offers.price`,
              url,
              viewport,
            }, { title: 'Product JSON-LD missing offers.price' });
          }

          const currency = offers['priceCurrency'];
          if (!currency || (typeof currency === 'string' && currency.trim() === '')) {
            emitBug(bugs, ctx, {
              ruleId: 'seo:jsonld-product-incomplete',
              severity: 'high',
              bugClass: 'seo',
              message: `Product JSON-LD missing/empty: offers.priceCurrency`,
              url,
              viewport,
            }, { title: 'Product JSON-LD missing offers.priceCurrency' });
          }
        }
      }
    }
  }

  // On PDPs, flag if no Product block was found at all
  if (isProductPage && !foundProductSchema) {
    emitBug(bugs, ctx, {
      ruleId: 'seo:jsonld-product-incomplete',
      severity: 'high',
      bugClass: 'seo',
      message: `Product JSON-LD missing/empty: no Product @type block found`,
      url,
      viewport,
    }, { title: 'No Product JSON-LD block on product page' });
  }
}
