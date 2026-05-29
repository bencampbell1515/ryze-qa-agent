import type { Page } from '@playwright/test';
import { countdownTimerRubric, wrongProductRubric } from '../../src/rubrics/index.js';
import { rubricsEnabled, runRubric } from './_rubric-gate.js';
import type { DualWriteContext } from './_emit.js';

/**
 * Standalone rubric-driven checks (worktree I).
 *
 * The countdown-timer and wrong-product false positives originated in the
 * persona discovery layer, which is out of scope for I. Rather than touch the
 * personas, these run as standalone rubric checks during the Playwright crawl:
 * the countdown rubric fires on any page with a visible countdown element; the
 * wrong-product rubric fires on /products/ pages and uses the redirect chain
 * (captured by the caller) to distinguish a by-design Shopify fallback from a
 * genuine mismatch.
 *
 * Both emit ONLY into the canonical Finding stream (findings.jsonl) — never the
 * legacy BugInstance/bugs.jsonl path — and both are no-ops unless
 * {@link rubricsEnabled} (RYZE_ENABLE_RUBRICS=1 + credentials + dual-write ctx).
 */

const COUNTDOWN_SELECTOR = '[data-countdown], .countdown, [class*="countdown"]';
const PRODUCT_TITLE_SELECTOR =
  'h1, [class*="product__title"], [class*="product-title"], [data-product-title]';

/** Extract the product handle (last path segment) from a /products/<handle> URL. */
function productHandle(rawUrl: string): string {
  try {
    const path = new URL(rawUrl).pathname;
    const m = path.match(/\/products\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  } catch {
    return '';
  }
}

/** Run the countdown-timer rubric if a countdown element is visible on the page. */
export async function runCountdownRubricCheck(
  page: Page,
  ctx?: DualWriteContext,
): Promise<void> {
  if (!rubricsEnabled(ctx)) return;

  const timer = page.locator(COUNTDOWN_SELECTOR).first();
  if (!(await timer.isVisible().catch(() => false))) return;

  const result = await runRubric(
    countdownTimerRubric,
    page,
    { kind: 'locator', locator: timer },
    { url: page.url() },
    ctx,
  );
  if (result?.finding) ctx.findings.add(result.finding);
}

/**
 * Run the wrong-product rubric on a /products/ page.
 * @param nav redirect context captured by the caller at navigation time. The
 *   wrong-product rubric needs to know whether a 30x redirect occurred —
 *   Playwright exposes that via `response.request().redirectedFrom()`, which the
 *   crawl loop reads and passes here. Without it, `redirected` defaults to false.
 */
export async function runWrongProductRubricCheck(
  page: Page,
  ctx: DualWriteContext | undefined,
  nav?: { requestedUrl?: string; redirected?: boolean },
): Promise<void> {
  if (!rubricsEnabled(ctx)) return;

  const url = page.url();
  if (!url.includes('/products/')) return;

  const title = page.locator(PRODUCT_TITLE_SELECTOR).first();
  if (!(await title.isVisible().catch(() => false))) return;

  const result = await runRubric(
    wrongProductRubric,
    page,
    { kind: 'locator', locator: title },
    {
      url,
      urlHandle: productHandle(nav?.requestedUrl ?? url),
      redirected: nav?.redirected ?? false,
    },
    ctx,
  );
  if (result?.finding) ctx.findings.add(result.finding);
}
