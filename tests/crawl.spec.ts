import { test, expect, resolveRunId } from './fixtures/bug-collector.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { discoverUrls } from '../src/crawl/sitemap.js';
import { attachNetworkListeners } from './checks/network.js';
import { takeScreenshot, triggerLazyLoad } from './checks/visual.js';
import { runSeoCheck } from './checks/seo.js';
import { runRevenueCheck, resetAtcCount } from './checks/revenue.js';
import { runImageCheck } from './checks/image.js';
import { runCurrencyCheck } from './checks/currency.js';
import { runJsonLdCheck } from './checks/jsonld.js';
import { runOpenGraphCheck } from './checks/opengraph.js';
import { runNewsletterCheck } from './checks/newsletter.js';
import { runSearchCheck } from './checks/search.js';
import { runExternalLinksCheck } from './checks/external-links.js';
import { runTapTargetsCheck } from './checks/tap-targets.js';
import type { UrlList, Viewport } from '../src/types.js';

const URL_LIST_PATH = join(process.cwd(), 'output', 'url-list.json');
const CRAWL_DELAY_MS = 1500;

function viewportFromProject(name: string | undefined): Viewport {
  if (!name) return 'desktop';
  if (name.includes('tablet')) return 'tablet';
  if (name.includes('mobile')) return 'mobile';
  return 'desktop';
}

// ── @crawl tag: discover URLs and write url-list.json ──────────────────────

test('@crawl — discover URLs from sitemaps', async ({ page }) => {
  const urlList = await discoverUrls();
  const totalUrls =
    Object.values(urlList).reduce((sum, arr) => sum + arr.length, 0);

  console.log(`Discovered ${totalUrls} URLs:`, {
    home: urlList.home.length,
    product: urlList.product.length,
    collection: urlList.collection.length,
    page: urlList.page.length,
    blog: urlList.blog.length,
    cart: urlList.cart.length,
    policy: urlList.policy.length,
  });

  writeFileSync(URL_LIST_PATH, JSON.stringify(urlList, null, 2));
  expect(totalUrls).toBeGreaterThan(0);
});

// ── @audit tag: run all checks across all URLs ────────────────────────────

test('@audit — run full audit across all URLs', async ({ page, bugs, findings }, testInfo) => {
  test.setTimeout(0); // audit crawls 200+ URLs — no wall-clock limit

  // worktree M: dual-write context handed to migrated checks. They emit the
  // legacy BugInstance (unchanged) AND a canonical Finding into findings.jsonl.
  // M1 migrates revenue.ts only; the other checks keep their 3-arg signature
  // until M2. runId is shared across desktop/tablet/mobile within one audit.
  const dualWrite = { findings, runId: resolveRunId() };

  // ACCUM-003: The 'lighthouse' project runs Lighthouse perf scores, not the general
  // URL audit. Running the audit under 'lighthouse' would label all bugs as 'desktop'
  // (viewportFromProject falls through), doubling desktop instanceCount in the report.
  if (testInfo.project.name === 'lighthouse') {
    return;
  }

  if (!existsSync(URL_LIST_PATH)) {
    throw new Error('Run npm run test:crawl first to generate url-list.json');
  }

  // ATC-001: Reset the ATC sample counter for each test run (each Playwright project
  // gets its own counter reset, so desktop/tablet/mobile each get up to ATC_SAMPLE_LIMIT flows).
  resetAtcCount();

  const urlList: UrlList = JSON.parse(readFileSync(URL_LIST_PATH, 'utf8'));
  const viewport = viewportFromProject(testInfo.project.name);

  const allUrls = [
    ...urlList.home,
    ...urlList.product,
    ...urlList.collection,
    ...urlList.page,
    ...urlList.cart,
    ...urlList.policy,
    ...urlList.blog,
  ];

  // Attach listeners once — they fire on all navigations within this page.
  // attachConsoleListeners() is intentionally NOT called: every js:pageerror /
  // console:error captured in headless Chrome is third-party noise (Popper.js,
  // analytics, jQuery-via-blocked-GTM). These flooded bugs.jsonl with ~13k
  // entries per run, all of which then hit validate.ts's Haiku queue at
  // pLimit(20) for 20–40 minutes before being filtered downstream. Killed at
  // the source. See CLAUDE.md "Known noise" + tests/checks/console.ts header.
  attachNetworkListeners(page, bugs, viewport);

  for (const url of allUrls) {
    const navOk = await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).then(() => true).catch((err: Error) => {
      bugs.add({ ruleId: 'network:nav-failed', severity: 'high', bugClass: 'network',
        message: `Navigation failed: ${url} — ${err.message.split('\n')[0]}`, url, viewport });
      return false;
    });
    if (!navOk) { await page.waitForTimeout(CRAWL_DELAY_MS).catch(() => {}); continue; }

    // Skip Cloudflare challenge pages — bot was blocked, no real content to check
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (bodyText.includes('Your connection needs to be verified') || bodyText.includes('Verifying you are human')) {
      await page.waitForTimeout(CRAWL_DELAY_MS).catch(() => {});
      continue;
    }

    await triggerLazyLoad(page);

    await runSeoCheck(page, bugs, viewport);
    await runImageCheck(page, bugs, viewport);
    await runCurrencyCheck(page, bugs, viewport).catch(() => {});
    await runJsonLdCheck(page, bugs, viewport).catch(() => {});
    await runOpenGraphCheck(page, bugs, viewport).catch(() => {});
    await runNewsletterCheck(page, bugs, viewport).catch(() => {});
    await runExternalLinksCheck(page, bugs, viewport).catch(() => {});
    await runTapTargetsCheck(page, bugs, viewport).catch(() => {});

    if (url.includes('/products/') || url.includes('/cart')) {
      await runRevenueCheck(page, bugs, viewport, dualWrite);
    }

    const slug = url.replace(/https?:\/\/[^/]+/, '').replace(/\//g, '-').slice(0, 60) || 'root';
    await takeScreenshot(page, slug, viewport).catch(() => {});

    await page.waitForTimeout(CRAWL_DELAY_MS).catch(() => {});
  }

  // Run search check once per audit run (not per URL — it navigates to /search itself).
  // Targets www.ryzesuperfoods.com only (shop. is Hydrogen, no /search endpoint).
  try {
    await page.goto('https://www.ryzesuperfoods.com/', { waitUntil: 'load', timeout: 30_000 });
    await runSearchCheck(page, bugs, viewport);
  } catch {
    // Search check failure is non-fatal — don't abort the audit's bug flush.
  }
});
