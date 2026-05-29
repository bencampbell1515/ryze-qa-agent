/**
 * Journey: checkout disclaimer link integrity.
 *
 * Motivating audit miss: the privacy-policy link inside the checkout disclaimer
 * 404s *in context*, even though visiting /policies/privacy-policy directly
 * loads fine. Page-at-a-time auditing cannot see this; only the checkout-
 * rendered DOM contains the broken contextual variant. This journey walks
 * PDP → cart → checkout, locates the disclaimer/policy area, and validates
 * every link inside it via worktree B's checkLinksInContainer.
 *
 * Output model: findings are emitted into the run's findings stream (the
 * product of this journey). The test stays GREEN as long as the flow runs —
 * site defects surface as findings, not as test failures (per the brief's
 * success criteria: "some may produce findings, that's expected").
 *
 * Run it:  RUN_JOURNEYS=1 npx playwright test tests/journeys/checkout-disclaimer-links.spec.ts --project=desktop
 *
 * ⚠ Conflict surfaced for PR: CLAUDE.md's ATC constraint says "confirm checkout
 *   button is enabled — then STOP. Do not click checkout." This journey
 *   deliberately proceeds INTO checkout (brief step 4) to inspect the disclaimer.
 *   The brief is authoritative and wins; we still never submit payment.
 */

import { test, expect } from '@playwright/test';
import {
  createRunContext,
  emitFinding,
  buildJourneyFinding,
  addToCart,
  DEFAULT_WWW_BASE,
} from './_helpers.js';
// LOCAL STUB until worktree B lands; swap to ../../src/cross-page/links-journey-helper.js then.
import { checkLinksInContainer } from './_links-journey-helper.js';

const RUN_JOURNEYS = !!process.env.RUN_JOURNEYS || !!process.env.RYZE_RUN_JOURNEYS;
const PRODUCT = process.env.RYZE_JOURNEY_PRODUCT ?? 'ryze-mushroom-coffee';

/** Text that identifies a merchant disclaimer / policy area. */
const DISCLAIMER_TEXT_RE =
  /by (completing|placing) (this|your) order|agree to|terms of (service|sale)|privacy policy|refund policy/i;

/** Candidate CSS containers for the checkout disclaimer/policy region.
 *  Native CSS only (the helper may querySelectorAll inside the page). */
const DISCLAIMER_SELECTOR_CANDIDATES = [
  '.os-step__footer',
  '[data-merchandise-policies]',
  '.policy-list',
  'footer[role="contentinfo"]',
  '[role="contentinfo"]',
  '.section--footer',
  '.main__footer',
  'footer',
];

/** Find the first candidate selector that exists and contains policy links. */
async function resolveDisclaimerSelector(page: import('@playwright/test').Page): Promise<string | null> {
  for (const sel of DISCLAIMER_SELECTOR_CANDIDATES) {
    const container = page.locator(sel).first();
    if ((await container.count().catch(() => 0)) === 0) continue;
    const text = ((await container.textContent().catch(() => '')) ?? '');
    const anchorCount = await container.locator('a[href]').count().catch(() => 0);
    const hasPolicyLink =
      anchorCount > 0 &&
      (DISCLAIMER_TEXT_RE.test(text) ||
        (await container
          .locator('a[href]')
          .filter({ hasText: /privacy|terms|refund|shipping|policy/i })
          .count()
          .catch(() => 0)) > 0);
    if (hasPolicyLink) return sel;
  }
  return null;
}

test.describe('journey: checkout disclaimer links', () => {
  test.beforeEach(() => {
    test.skip(!RUN_JOURNEYS, 'Live journey — set RUN_JOURNEYS=1 (hits the live storefront + Shopify checkout).');
  });
  // Recharge ATC (10–15s) + cart + cross-origin checkout: this is a slow flow.
  test.setTimeout(180_000);

  test('every link in the checkout disclaimer resolves', async ({ page }, testInfo) => {
    const ctx = createRunContext('checkout-disclaimer');

    // 1–2. PDP → add to cart.
    const atc = await addToCart(page, PRODUCT);
    if (!atc.added) {
      emitFinding(
        ctx,
        buildJourneyFinding({
          runId: ctx.runId,
          ruleId: 'journey:flow-incomplete',
          severity: 'medium',
          url: atc.productUrl,
          title: 'Could not add product to cart; checkout-disclaimer journey did not complete',
          description: `addToCart did not confirm an add for "${PRODUCT}" (${atc.detail}). The disclaimer-link check could not run.`,
          meta: { step: 'add-to-cart', productHandle: PRODUCT, detail: atc.detail },
        }),
      );
      await testInfo.attach('journey-findings.json', { body: JSON.stringify(ctx.findings, null, 2), contentType: 'application/json' });
      return;
    }

    // 3. Cart.
    await page.goto(`${DEFAULT_WWW_BASE}/cart`, { waitUntil: 'domcontentloaded' });

    // 4. Checkout (cross-origin allowed within the same browser context).
    const checkoutBtn = page
      .locator('button[name="checkout"], input[name="checkout"], #checkout, a[href*="/checkout"]')
      .first();
    const checkoutVisible = await checkoutBtn
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!checkoutVisible) {
      emitFinding(
        ctx,
        buildJourneyFinding({
          runId: ctx.runId,
          ruleId: 'journey:flow-incomplete',
          severity: 'medium',
          url: page.url(),
          title: 'Checkout button not found on /cart; disclaimer-link check skipped',
          description: 'No checkout control was visible on /cart, so the journey could not reach the checkout disclaimer.',
          meta: { step: 'cart-to-checkout' },
        }),
      );
      await testInfo.attach('journey-findings.json', { body: JSON.stringify(ctx.findings, null, 2), contentType: 'application/json' });
      return;
    }

    await Promise.all([
      page.waitForURL(/\/checkouts?\//i, { timeout: 30_000 }).catch(() => {}),
      checkoutBtn.click({ timeout: 15_000 }).catch(() => {}),
    ]);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const checkoutUrl = page.url();

    // 5. Locate the disclaimer / policy container.
    const disclaimerSelector = await resolveDisclaimerSelector(page);
    if (!disclaimerSelector) {
      // Brief: missing disclaimer implies the legal disclaimer disappeared → critical.
      emitFinding(
        ctx,
        buildJourneyFinding({
          runId: ctx.runId,
          ruleId: 'journey:disclaimer-missing',
          severity: 'critical',
          url: checkoutUrl,
          title: 'Checkout disclaimer / policy area not found',
          description:
            `No disclaimer or policy-link container was found at checkout (${checkoutUrl}). ` +
            `The legal disclaimer (privacy/terms/refund links) may have disappeared, which is a compliance risk.`,
          remediation: 'Verify the checkout footer/policy block renders. If the selectors changed, update DISCLAIMER_SELECTOR_CANDIDATES.',
          meta: { step: 'locate-disclaimer', checkoutUrl },
        }),
      );
      await testInfo.attach('journey-findings.json', { body: JSON.stringify(ctx.findings, null, 2), contentType: 'application/json' });
      return;
    }

    // 6. Validate every link in the disclaimer container (worktree B's helper).
    const linkFindings = await checkLinksInContainer(page, disclaimerSelector, ctx.runId, 'checkout-disclaimer');
    for (const f of linkFindings) emitFinding(ctx, f);

    await testInfo.attach('journey-findings.json', {
      body: JSON.stringify(ctx.findings, null, 2),
      contentType: 'application/json',
    });
    // eslint-disable-next-line no-console
    console.log(
      `[journey:checkout-disclaimer] container="${disclaimerSelector}" url=${checkoutUrl} ` +
        `linkFindings=${linkFindings.length} totalFindings=${ctx.findings.length}`,
    );

    // The journey is GREEN when the flow ran. Findings (incl. broken links) are
    // the product, written to the findings stream, not test failures.
    expect(ctx.runId).toBeTruthy();
  });
});
