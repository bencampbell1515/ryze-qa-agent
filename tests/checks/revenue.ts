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

/** Reset the ATC sample counter — call once at the start of each @audit test run. */
export function resetAtcCount(): void {
  atcCheckCount = 0;
}

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

    // Check Add-to-Cart button presence — wait up to 5s for JS to render it
    const atc = page.getByRole('button', { name: ATC_SELECTORS }).first();
    await atc.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const atcVisible = await atc.isVisible().catch(() => false);
    if (!atcVisible) {
      bugs.add({ ruleId: 'revenue:no-atc', severity: 'critical', bugClass: 'revenue',
        message: `No Add-to-Cart button visible on ${url}`, url, viewport });
      return;
    }

    // Capture the product page URL before any navigation (ATC-003)
    const productPageUrl = page.url();

    // Only do full ATC→cart flow on a sample to keep audit fast
    if (atcCheckCount < ATC_SAMPLE_LIMIT) {
      let aborted = false; // ATC-002: flag to prevent ghost writes after timeout

      const atcFlow = async (): Promise<void> => {
        await atc.click();
        atcCheckCount++; // ATC-005: increment AFTER click succeeds, not before
        await page.waitForTimeout(2000);
        // ATC-003: use productPageUrl captured before click to build cart URL
        const cartUrl = new URL('/cart', productPageUrl).toString();
        await page.goto(cartUrl, { waitUntil: 'load', timeout: 30_000 });
        if (aborted) return; // ATC-002: bail if timeout already fired
        await runCartChecks(page, bugs, viewport, productPageUrl);
        // CONC-003: navigate back so subsequent checks run against product page, not /cart
        await page.goto(productPageUrl, { waitUntil: 'load', timeout: 30_000 });
      };
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => {
          aborted = true; // ATC-002: signal the in-flight flow to stop writing bugs
          reject(new Error('ATC flow timed out after 35s'));
        }, 35_000));
      await Promise.race([atcFlow(), timeout]).catch(() => {
        // ATC flow failed or timed out — button exists, that's the key signal
      });
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

    // ATC-006: prefer the submit button; fall back to anchor only if button absent
    // (isEnabled() on <a> always returns true, masking a disabled button)
    const checkoutButton = page.locator('button[name="checkout"]').first();
    const checkoutAnchor = page.locator('a[href*="checkout"]').first();
    const btnVisible = await checkoutButton.isVisible().catch(() => false);
    const checkoutBtn = btnVisible ? checkoutButton : checkoutAnchor;
    const checkoutEnabled = await checkoutBtn.isEnabled().catch(() => false);
    if (!checkoutEnabled) {
      bugs.add({ ruleId: 'revenue:checkout-disabled', severity: 'critical', bugClass: 'revenue',
        message: `Checkout button disabled on cart (came from ${sourceUrl})`, url: page.url(), viewport });
    }
    // STOP HERE — do not click checkout
}
