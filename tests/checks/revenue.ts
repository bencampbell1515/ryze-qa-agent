import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

const PRICE_SELECTORS = [
  '[data-product-price]',
  '.price__current',
  '.price',
  '[class*="price"]',
];

const ATC_SELECTORS = /add to cart|subscribe|buy now/i;

// Track how many products have had the full ATC→cart flow run
let atcCheckCount = 0;
const ATC_SAMPLE_LIMIT = 5;

export async function runRevenueCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  const url = page.url();

  if (url.includes('/products/')) {
    // Check price renders
    let priceFound = false;
    for (const sel of PRICE_SELECTORS) {
      const text = await page.locator(sel).first().textContent().catch(() => null);
      if (text && /\$\d/.test(text)) { priceFound = true; break; }
    }
    if (!priceFound) {
      bugs.add({ ruleId: 'revenue:no-price', severity: 'critical', bugClass: 'revenue',
        message: `No visible price found on ${url}`, url, viewport });
    }

    // Check Add-to-Cart button presence
    const atc = page.getByRole('button', { name: ATC_SELECTORS }).first();
    const atcVisible = await atc.isVisible().catch(() => false);
    if (!atcVisible) {
      bugs.add({ ruleId: 'revenue:no-atc', severity: 'critical', bugClass: 'revenue',
        message: `No Add-to-Cart button visible on ${url}`, url, viewport });
      return;
    }

    // Only do full ATC→cart flow on a sample to keep audit fast
    if (atcCheckCount < ATC_SAMPLE_LIMIT) {
      atcCheckCount++;
      await atc.click();
      await page.waitForTimeout(2000); // let cart drawer/update settle
      const cartUrl = new URL('/cart', page.url()).toString();
      await page.goto(cartUrl, { waitUntil: 'load', timeout: 30_000 });
      await runCartChecks(page, bugs, viewport, url);
    }
  }

  // Run cart checks when navigated directly to /cart
  if (url.includes('/cart')) {
    await runCartChecks(page, bugs, viewport, url);
  }
}

async function runCartChecks(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
  sourceUrl: string,
): Promise<void> {
    const subtotal = await page.locator('[data-cart-subtotal], .cart__subtotal, [class*="subtotal"]')
      .first().textContent().catch(() => null);
    if (!subtotal || !/\$\d/.test(subtotal)) {
      bugs.add({ ruleId: 'revenue:cart-subtotal-missing', severity: 'critical', bugClass: 'revenue',
        message: `Cart subtotal missing/invalid (came from ${sourceUrl})`, url: page.url(), viewport });
    }

    const checkoutBtn = page.locator('button[name="checkout"], a[href*="checkout"]').first();
    const checkoutEnabled = await checkoutBtn.isEnabled().catch(() => false);
    if (!checkoutEnabled) {
      bugs.add({ ruleId: 'revenue:checkout-disabled', severity: 'critical', bugClass: 'revenue',
        message: `Checkout button disabled on cart (came from ${sourceUrl})`, url: page.url(), viewport });
    }
    // STOP HERE — do not click checkout
}
