import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

const PRICE_SELECTORS = [
  '[data-product-price]',
  '.price__current',
  '.price',
  '[class*="price"]',
];

const ATC_SELECTORS = /add to cart|subscribe|buy now|get started/i;

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

/** Parse a price string like "$29.99" or "USD 30" into a float. */
export function parsePrice(text: string): number {
  return parseFloat(text.replace(/[^\d.]/g, ''));
}

const LINE_ITEM_SELECTOR =
  '.cart-item, [data-cart-item], .cart__row, tr.line-item, [data-cart-line-item], li.cart__item';

const SUBTOTAL_SELECTOR = '[data-cart-subtotal], .cart__subtotal, [class*="subtotal"]';

async function runCartChecks(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
  sourceUrl: string,
): Promise<void> {
    // ATC-007: an empty cart has no subtotal and no checkout button by design.
    // Skip checks unless the cart actually contains line items — otherwise direct
    // navigation to /cart URLs (or a too-short ATC wait) produces false-positive criticals.
    const hasItems = await page.locator(LINE_ITEM_SELECTOR).first().isVisible().catch(() => false);
    if (!hasItems) return;

    const subtotal = await page.locator(SUBTOTAL_SELECTOR)
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

    // ── Mutation check 1: Quantity change ────────────────────────────────────
    try {
      const qtySelectors = [
        'input[name="updates[]"]',
        'input[name^="updates"]',
        '[data-quantity-input]',
      ];
      let qtyInput: import('@playwright/test').Locator | null = null;
      for (const sel of qtySelectors) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) { qtyInput = loc; break; }
      }

      if (qtyInput) {
        const subtotalBefore = await page.locator(SUBTOTAL_SELECTOR).first().textContent().catch(() => null);
        const priceBefore = subtotalBefore ? parsePrice(subtotalBefore) : 0;

        // Try increment button first; fall back to typing into the input
        const plusSelectors = [
          '[data-quantity-plus]',
          'button.qty-plus',
          '[aria-label*="increase" i]',
        ];
        let incremented = false;
        for (const sel of plusSelectors) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible().catch(() => false)) {
            await btn.click().catch(() => {});
            incremented = true;
            break;
          }
        }
        if (!incremented) {
          await qtyInput.fill('2').catch(() => {});
          await qtyInput.blur().catch(() => {});
        }

        await page.waitForTimeout(2000).catch(() => {});

        const subtotalAfter = await page.locator(SUBTOTAL_SELECTOR).first().textContent().catch(() => null);
        const priceAfter = subtotalAfter ? parsePrice(subtotalAfter) : 0;

        if (priceAfter <= priceBefore) {
          bugs.add({
            ruleId: 'revenue:cart-qty-no-update',
            severity: 'high',
            bugClass: 'revenue',
            message: `Quantity changed from 1 to 2 but subtotal did not update on cart (came from ${sourceUrl})`,
            url: page.url(),
            viewport,
          });
        }
      }
    } catch { /* swallow per-mutation error */ }

    // ── Mutation check 2: Discount-code invalid path ──────────────────────────
    try {
      const discountSelectors = [
        'input[name="discount"]',
        'input#discount',
        'input[name*="discount" i]',
        'input[placeholder*="discount" i]',
        'input[placeholder*="coupon" i]',
        'input[placeholder*="promo" i]',
      ];
      let discountInput: import('@playwright/test').Locator | null = null;
      for (const sel of discountSelectors) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) { discountInput = loc; break; }
      }

      if (discountInput) {
        await discountInput.fill('INVALIDQACODE-9999').catch(() => {});

        // Find the apply button
        const applySelectors = [
          'button[name="apply"]',
          'button.discount__apply',
        ];
        let applyBtn: import('@playwright/test').Locator | null = null;
        for (const sel of applySelectors) {
          const loc = page.locator(sel).first();
          if (await loc.isVisible().catch(() => false)) { applyBtn = loc; break; }
        }
        if (!applyBtn) {
          // Try nearest submit/generic button with apply-like text
          const genericApply = page.getByRole('button', { name: /apply|enter|use/i }).first();
          if (await genericApply.isVisible().catch(() => false)) applyBtn = genericApply;
        }

        if (applyBtn) {
          await applyBtn.click().catch(() => {});
          await page.waitForTimeout(2000).catch(() => {});

          // Check for error feedback
          const errorVisible = await page.locator(
            '[class*="error"], [class*="invalid"], [aria-invalid="true"]',
          ).filter({ hasText: /invalid|not found|expired|cannot|unable|doesn't exist|isn't valid/i })
            .first().isVisible().catch(() => false);

          const errorText = await page.getByText(
            /invalid|not found|expired|cannot|unable|doesn't exist|isn't valid/i,
          ).first().isVisible().catch(() => false);

          const inputInvalid = await discountInput.getAttribute('aria-invalid').catch(() => null) === 'true'
            || (await discountInput.getAttribute('class').catch(() => '') ?? '').includes('error');

          if (!errorVisible && !errorText && !inputInvalid) {
            bugs.add({
              ruleId: 'revenue:discount-invalid-no-error',
              severity: 'medium',
              bugClass: 'revenue',
              message: `Invalid discount code typed but no error feedback shown (came from ${sourceUrl})`,
              url: page.url(),
              viewport,
            });
          }
        }
      }
    } catch { /* swallow per-mutation error */ }

    // ── Mutation check 3: Gift-message / order-note persistence ──────────────
    try {
      const noteSelectors = [
        'textarea[name="note"]',
        'textarea#cart-note',
        'textarea[name="order_note"]',
        'textarea[placeholder*="note" i]',
        'textarea[placeholder*="gift" i]',
        'textarea[placeholder*="message" i]',
      ];
      let noteTextarea: import('@playwright/test').Locator | null = null;
      for (const sel of noteSelectors) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) { noteTextarea = loc; break; }
      }

      if (noteTextarea) {
        const sentinel = `RYZE-QA-PERSISTENCE-PROBE-${Date.now().toString()}`;
        await noteTextarea.fill(sentinel).catch(() => {});
        await noteTextarea.blur().catch(() => {});
        await page.waitForTimeout(1500).catch(() => {});

        const cartUrl = page.url();
        await page.goto(cartUrl, { waitUntil: 'load' }).catch(() => {});
        await page.waitForTimeout(1500).catch(() => {});

        let foundSentinel = false;
        for (const sel of noteSelectors) {
          const loc = page.locator(sel).first();
          if (await loc.isVisible().catch(() => false)) {
            const val = await loc.inputValue().catch(() => '');
            if (val.includes(sentinel)) { foundSentinel = true; break; }
            break; // textarea exists but value doesn't match — not found
          }
        }

        if (!foundSentinel) {
          bugs.add({
            ruleId: 'revenue:cart-note-not-persisted',
            severity: 'medium',
            bugClass: 'revenue',
            message: `Cart note did not persist across reload (came from ${sourceUrl})`,
            url: page.url(),
            viewport,
          });
        }
      }
    } catch { /* swallow per-mutation error */ }

    // ── Mutation check 4: Line-item removal (last — empties cart) ────────────
    try {
      const removeSelectors = [
        'a[href*="updates" i][href*="=0"]',
        'button[name="remove"]',
        '[data-cart-remove]',
        '[aria-label*="remove" i]',
      ];
      let removeControl: import('@playwright/test').Locator | null = null;
      for (const sel of removeSelectors) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) { removeControl = loc; break; }
      }

      if (removeControl) {
        const countBefore = await page.locator(LINE_ITEM_SELECTOR).count().catch(() => 0);
        await removeControl.click().catch(() => {});
        await page.waitForTimeout(2500).catch(() => {});
        const countAfter = await page.locator(LINE_ITEM_SELECTOR).count().catch(() => 0);

        if (countAfter >= countBefore) {
          bugs.add({
            ruleId: 'revenue:cart-remove-broken',
            severity: 'high',
            bugClass: 'revenue',
            message: `Clicking line-item remove did not reduce cart items (came from ${sourceUrl})`,
            url: page.url(),
            viewport,
          });
        }
      }
    } catch { /* swallow per-mutation error */ }
}
