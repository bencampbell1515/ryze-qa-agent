/**
 * Journey: cart → checkout line-item continuity.
 *
 * Audit miss: nothing currently asserts that what's in the cart actually
 * carries into checkout with the same quantity and line price. This journey
 * captures cart line items (accessibility-tree based, not pixel reading),
 * proceeds to checkout, captures the checkout line items, and asserts each
 * cart item is present in checkout with matching quantity and line price.
 *
 * Findings (emitted into the run's findings stream):
 *   - journey:cart-checkout-item-mismatch  (critical) — item missing or qty differs
 *   - journey:cart-checkout-price-mismatch (high)     — qty matches, line price differs
 *
 * Run it:  RUN_JOURNEYS=1 npx playwright test tests/journeys/cart-to-checkout-continuity.spec.ts --project=desktop
 *
 * ⚠ Same checkout-navigation conflict as checkout-disclaimer-links.spec.ts —
 *   the brief authorizes proceeding into checkout; we never submit payment.
 */

import { test, expect } from '@playwright/test';
import {
  createRunContext,
  emitFinding,
  buildJourneyFinding,
  addToCart,
  gotoCart,
  waitForCartItems,
  looksLikeCheckout,
  getCartLineItems,
  getCheckoutLineItems,
  DEFAULT_WWW_BASE,
  type LineItem,
} from './_helpers.js';

const RUN_JOURNEYS = !!process.env.RUN_JOURNEYS || !!process.env.RYZE_RUN_JOURNEYS;
const PRODUCT = process.env.RYZE_JOURNEY_PRODUCT ?? 'ryze-mushroom-coffee';

/** Normalize a product name for cross-step matching. */
function normName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

test.describe('journey: cart → checkout continuity', () => {
  test.beforeEach(() => {
    test.skip(!RUN_JOURNEYS, 'Live journey — set RUN_JOURNEYS=1 (hits the live storefront + Shopify checkout).');
  });
  test.setTimeout(180_000);

  test('every cart item appears in checkout with matching qty and price', async ({ page }, testInfo) => {
    const ctx = createRunContext('cart-checkout-continuity');

    const atc = await addToCart(page, PRODUCT);
    if (!atc.added) {
      emitFinding(ctx, buildJourneyFinding({
        runId: ctx.runId,
        ruleId: 'journey:flow-incomplete',
        severity: 'medium',
        url: atc.productUrl,
        title: 'Could not add product to cart; continuity journey did not complete',
        description: `addToCart did not confirm an add for "${PRODUCT}" (${atc.detail}).`,
        meta: { step: 'add-to-cart', productHandle: PRODUCT, detail: atc.detail },
      }));
      await testInfo.attach('journey-findings.json', { body: JSON.stringify(ctx.findings, null, 2), contentType: 'application/json' });
      return;
    }

    // Capture cart line items (wait for the JS-rendered cart to populate).
    await gotoCart(page);
    await waitForCartItems(page);
    const cartItems = await getCartLineItems(page);

    if (cartItems.length === 0) {
      emitFinding(ctx, buildJourneyFinding({
        runId: ctx.runId,
        ruleId: 'journey:flow-incomplete',
        severity: 'medium',
        url: page.url(),
        title: 'No cart line items detected after add-to-cart',
        description: 'getCartLineItems returned empty on /cart after a confirmed add. Either the add did not persist or the cart DOM selectors need updating.',
        meta: { step: 'capture-cart' },
      }));
      await testInfo.attach('journey-findings.json', { body: JSON.stringify(ctx.findings, null, 2), contentType: 'application/json' });
      return;
    }

    // Proceed to checkout.
    const checkoutBtn = page
      .locator('button[name="checkout"], input[name="checkout"], #checkout, a[href*="/checkout"]')
      .first();
    const checkoutVisible = await checkoutBtn.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!checkoutVisible) {
      emitFinding(ctx, buildJourneyFinding({
        runId: ctx.runId,
        ruleId: 'journey:flow-incomplete',
        severity: 'medium',
        url: page.url(),
        title: 'Checkout button not found on /cart; continuity check skipped',
        description: 'No checkout control was visible on /cart.',
        meta: { step: 'cart-to-checkout' },
      }));
      await testInfo.attach('journey-findings.json', { body: JSON.stringify(ctx.findings, null, 2), contentType: 'application/json' });
      return;
    }
    await Promise.all([
      page.waitForURL(/\/checkouts?\//i, { timeout: 30_000 }).catch(() => {}),
      checkoutBtn.click({ timeout: 15_000 }).catch(() => {}),
    ]);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2_000).catch(() => {});
    const checkoutUrl = page.url();

    // Verify we actually reached checkout. In a bot/headless context the
    // storefront bounces the checkout handoff back to the storefront; comparing
    // against that page would raise a false "item-mismatch" critical for every
    // cart item. Record an honest flow-incomplete instead and stop.
    if (!(await looksLikeCheckout(page))) {
      emitFinding(ctx, buildJourneyFinding({
        runId: ctx.runId,
        ruleId: 'journey:flow-incomplete',
        severity: 'medium',
        url: checkoutUrl,
        title: 'Checkout was not reachable; cart→checkout continuity could not be verified',
        description:
          `After clicking checkout, the page is "${checkoutUrl}", which is not a Shopify checkout. In a bot/headless ` +
          `context the storefront bounces the checkout handoff, so checkout line items cannot be compared here. Run ` +
          `this journey in a context that can reach Shopify checkout (the trusted O2O session the live audit uses).`,
        meta: { step: 'reach-checkout', landedUrl: checkoutUrl },
      }));
      await testInfo.attach('journey-findings.json', { body: JSON.stringify(ctx.findings, null, 2), contentType: 'application/json' });
      return;
    }

    // Capture checkout line items.
    const checkoutItems = await getCheckoutLineItems(page);

    // Compare: every cart item must appear in checkout with matching qty & price.
    const findByName = (items: LineItem[], name: string) =>
      items.find((i) => normName(i.name) === normName(name));

    for (const cartItem of cartItems) {
      const match = findByName(checkoutItems, cartItem.name);
      const element = { role: 'row', name: cartItem.name };

      if (!match || match.quantity !== cartItem.quantity) {
        emitFinding(ctx, buildJourneyFinding({
          runId: ctx.runId,
          ruleId: 'journey:cart-checkout-item-mismatch',
          severity: 'critical',
          url: checkoutUrl,
          relatedUrls: [`${DEFAULT_WWW_BASE}/cart`],
          element,
          title: match
            ? `Quantity mismatch for "${cartItem.name}" between cart and checkout`
            : `Cart item "${cartItem.name}" is missing from checkout`,
          description: match
            ? `Cart shows quantity ${cartItem.quantity} for "${cartItem.name}", but checkout shows ${match.quantity}. Item/quantity continuity is broken between cart and checkout — a direct revenue/trust risk.`
            : `"${cartItem.name}" (qty ${cartItem.quantity}, ${cartItem.linePrice || 'unknown price'}) is present in the cart but was not found in the checkout order summary.`,
          meta: {
            step: 'compare',
            cartQuantity: cartItem.quantity,
            checkoutQuantity: match ? match.quantity : null,
            cartLinePrice: cartItem.linePrice || null,
            checkoutLinePrice: match ? match.linePrice || null : null,
          },
        }));
        continue;
      }

      // Quantity matches — compare line price (only when both are parseable).
      if (
        cartItem.linePriceCents !== null &&
        match.linePriceCents !== null &&
        cartItem.linePriceCents !== match.linePriceCents
      ) {
        emitFinding(ctx, buildJourneyFinding({
          runId: ctx.runId,
          ruleId: 'journey:cart-checkout-price-mismatch',
          severity: 'high',
          url: checkoutUrl,
          relatedUrls: [`${DEFAULT_WWW_BASE}/cart`],
          element,
          title: `Line price mismatch for "${cartItem.name}" between cart and checkout`,
          description: `Cart line price for "${cartItem.name}" (qty ${cartItem.quantity}) is ${cartItem.linePrice}, but checkout shows ${match.linePrice}. The shopper is quoted a different price at checkout than in the cart.`,
          meta: {
            step: 'compare',
            quantity: cartItem.quantity,
            cartLinePrice: cartItem.linePrice,
            checkoutLinePrice: match.linePrice,
            cartCents: cartItem.linePriceCents,
            checkoutCents: match.linePriceCents,
          },
        }));
      }
    }

    await testInfo.attach('journey-findings.json', { body: JSON.stringify(ctx.findings, null, 2), contentType: 'application/json' });
    // eslint-disable-next-line no-console
    console.log(
      `[journey:cart-checkout-continuity] cartItems=${cartItems.length} checkoutItems=${checkoutItems.length} ` +
        `findings=${ctx.findings.length} url=${checkoutUrl}`,
    );

    expect(ctx.runId).toBeTruthy();
  });
});
