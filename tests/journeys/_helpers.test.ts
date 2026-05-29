import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import {
  parsePriceToCents,
  getCartLineItems,
  getCheckoutLineItems,
  journeyFingerprint,
} from './_helpers.js';

/**
 * Unit tests for the journey helpers. These do NOT hit the live site — they
 * drive a real Chromium page via `setContent` (the same pattern the rest of
 * the repo's check unit tests use, e.g. tests/unit/tap-targets.test.ts).
 */

async function pageWith(html: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(html);
  return { browser, page };
}

test.describe('parsePriceToCents', () => {
  test('parses "$60.00" → 6000', () => {
    expect(parsePriceToCents('$60.00')).toBe(6000);
  });

  test('parses "$1,234.56" → 123456 (thousands separator)', () => {
    expect(parsePriceToCents('$1,234.56')).toBe(123456);
  });

  test('parses "30 USD" → 3000 (currency code suffix)', () => {
    expect(parsePriceToCents('30 USD')).toBe(3000);
  });

  test('parses bare integer "$30" → 3000', () => {
    expect(parsePriceToCents('$30')).toBe(3000);
  });

  test('treats "Free" as 0 cents', () => {
    expect(parsePriceToCents('Free')).toBe(0);
  });

  test('returns null for text with no price', () => {
    expect(parsePriceToCents('Quantity')).toBeNull();
    expect(parsePriceToCents('')).toBeNull();
  });
});

test.describe('journeyFingerprint', () => {
  test('is stable for the same ruleId + url + element signature', () => {
    const a = journeyFingerprint('journey:cart-checkout-item-mismatch', 'https://x/cart', {
      role: 'row',
      name: 'RYZE Mushroom Coffee',
    });
    const b = journeyFingerprint('journey:cart-checkout-item-mismatch', 'https://x/cart', {
      role: 'row',
      name: 'RYZE Mushroom Coffee',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });

  test('differs when the element accessible name differs', () => {
    const a = journeyFingerprint('journey:x', 'https://x/cart', { role: 'row', name: 'Coffee' });
    const b = journeyFingerprint('journey:x', 'https://x/cart', { role: 'row', name: 'Matcha' });
    expect(a).not.toBe(b);
  });
});

test.describe('getCartLineItems', () => {
  test('extracts {name, quantity, linePrice} from a Shopify-style cart table', async () => {
    // Dawn-style cart: <tr> rows with a product link, a number input for qty,
    // and a line price cell.
    const { browser, page } = await pageWith(`<!DOCTYPE html><html><body>
      <table class="cart-items">
        <thead>
          <tr><th>Product</th><th>Quantity</th><th>Total</th></tr>
        </thead>
        <tbody>
          <tr class="cart-item">
            <td><a href="/products/ryze-mushroom-coffee">RYZE Mushroom Coffee</a></td>
            <td><input type="number" aria-label="Quantity for RYZE Mushroom Coffee" value="2"></td>
            <td class="cart-item__price">$60.00</td>
          </tr>
          <tr class="cart-item">
            <td><a href="/products/ryze-mushroom-matcha">RYZE Mushroom Matcha</a></td>
            <td><input type="number" aria-label="Quantity for RYZE Mushroom Matcha" value="1"></td>
            <td class="cart-item__price">$36.00</td>
          </tr>
        </tbody>
      </table>
    </body></html>`);

    const items = await getCartLineItems(page);
    await browser.close();

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'RYZE Mushroom Coffee',
      quantity: 2,
      linePriceCents: 6000,
    });
    expect(items[0].linePrice).toContain('$60.00');
    expect(items[1]).toMatchObject({
      name: 'RYZE Mushroom Matcha',
      quantity: 1,
      linePriceCents: 3600,
    });
    // The header row (no product link) must NOT be returned as a line item.
    expect(items.every((i) => i.name.length > 0)).toBe(true);
  });

  test('returns [] (no throw) when the page has no cart structure', async () => {
    const { browser, page } = await pageWith(
      `<!DOCTYPE html><html><body><main><p>Your cart is empty.</p></main></body></html>`,
    );
    const items = await getCartLineItems(page);
    await browser.close();
    expect(items).toEqual([]);
  });
});

test.describe('getCheckoutLineItems', () => {
  test('extracts line items from a checkout order-summary list', async () => {
    // Shopify checkout order summary: product rows with name, a quantity badge
    // (text, not an input), and a line price.
    const { browser, page } = await pageWith(`<!DOCTYPE html><html><body>
      <div role="table" aria-label="Order summary">
        <div role="row" class="product">
          <a href="/products/ryze-mushroom-coffee">RYZE Mushroom Coffee</a>
          <span aria-label="Quantity">2</span>
          <span class="order-summary__emphasis">$60.00</span>
        </div>
        <div role="row" class="product">
          <a href="/products/ryze-mushroom-matcha">RYZE Mushroom Matcha</a>
          <span aria-label="Quantity">1</span>
          <span class="order-summary__emphasis">$36.00</span>
        </div>
      </div>
    </body></html>`);

    const items = await getCheckoutLineItems(page);
    await browser.close();

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'RYZE Mushroom Coffee', quantity: 2, linePriceCents: 6000 });
    expect(items[1]).toMatchObject({ name: 'RYZE Mushroom Matcha', quantity: 1, linePriceCents: 3600 });
  });

  test('returns [] (no throw) when no order summary is present', async () => {
    const { browser, page } = await pageWith(
      `<!DOCTYPE html><html><body><h1>Loading…</h1></body></html>`,
    );
    const items = await getCheckoutLineItems(page);
    await browser.close();
    expect(items).toEqual([]);
  });
});
