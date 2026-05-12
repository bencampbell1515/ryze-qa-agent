import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

/**
 * Classifies the state of a search results page based on HTTP status,
 * no-results text, and product link count.
 *
 * Returns one of:
 *   - 'ok': Search page is healthy (has product links or clear results)
 *   - 'http-error': Response status >= 400
 *   - 'no-results': Page indicates no results found (but rendering is OK)
 *   - 'rendering-broken': No results text AND no product links (suspicious)
 */
export function classifySearchPage(
  bodyText: string,
  productLinkCount: number,
  status: number,
): 'ok' | 'http-error' | 'no-results' | 'rendering-broken' {
  if (status >= 400) return 'http-error';

  const noResultsPatterns = [
    /no results?/i,
    /0 results?/i,
    /sorry, nothing/i,
    /no matches/i,
    /couldn't find/i,
  ];

  const hasNoResultsText = noResultsPatterns.some((pattern) =>
    pattern.test(bodyText),
  );

  if (hasNoResultsText && productLinkCount === 0) return 'no-results';
  if (!hasNoResultsText && productLinkCount === 0) return 'rendering-broken';

  return 'ok';
}

/**
 * Verifies that the search results page (/search?q=coffee) renders sensibly.
 *
 * This check ONLY runs once per audit run, not on every URL.
 * The caller is responsible for calling this check only once and not
 * navigating back after it completes.
 *
 * Logic:
 * 1. Capture origin from current page URL
 * 2. Navigate to ${origin}/search?q=coffee with domcontentloaded + 2s buffer
 * 3. Check HTTP status and classify the search results page
 * 4. Flag issues based on classification:
 *    - http-error: flag content:search-broken, severity high
 *    - no-results: flag content:search-no-results-for-coffee, severity medium
 *    - rendering-broken: flag content:search-rendering-broken, severity high
 *    - ok: no bug
 */
export async function runSearchCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  try {
    const currentUrl = page.url();
    const origin = new URL(currentUrl).origin;
    const searchUrl = `${origin}/search?q=coffee`;

    // Navigate to search page with Cloudflare buffer
    const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
      .catch(() => null);

    // Wait 2s for any post-load JS to settle (Cloudflare gotcha: always catch)
    await page.waitForTimeout(2000).catch(() => {});

    const status = response?.status() ?? 500;
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const productLinkCount = await page
      .locator('a[href*="/products/"]')
      .count()
      .catch(() => 0);

    const classification = classifySearchPage(bodyText, productLinkCount, status);

    if (classification === 'http-error') {
      bugs.add({
        ruleId: 'content:search-broken',
        severity: 'high',
        bugClass: 'content',
        message: `Search page returned HTTP ${status} for query "coffee"`,
        url: searchUrl,
        viewport,
      });
    } else if (classification === 'no-results') {
      bugs.add({
        ruleId: 'content:search-no-results-for-coffee',
        severity: 'medium',
        bugClass: 'content',
        message: `Search for "coffee" (RYZE's hero product) returned a no-results state`,
        url: searchUrl,
        viewport,
      });
    } else if (classification === 'rendering-broken') {
      bugs.add({
        ruleId: 'content:search-rendering-broken',
        severity: 'high',
        bugClass: 'content',
        message: `Search results page for "coffee" rendered with no products and no no-results message — likely broken layout`,
        url: searchUrl,
        viewport,
      });
    }
    // If classification === 'ok', no bug is added
  } catch (err) {
    // If search navigation throws unexpectedly, skip quietly (network error, etc.)
    // Do not add a bug — the issue is a transient network problem, not a site defect.
  }
}
