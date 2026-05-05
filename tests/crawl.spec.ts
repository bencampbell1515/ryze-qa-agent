import { test, expect } from './fixtures/bug-collector.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { discoverUrls } from '../src/crawl/sitemap.js';
import { runA11yCheck } from './checks/a11y.js';
import { attachConsoleListeners } from './checks/console.js';
import { attachNetworkListeners } from './checks/network.js';
import { takeScreenshot, triggerLazyLoad } from './checks/visual.js';
import { runSeoCheck } from './checks/seo.js';
import { runRevenueCheck, resetAtcCount } from './checks/revenue.js';
import { runContentCheck } from './checks/content.js';
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

test('@audit — run full audit across all URLs', async ({ page, bugs }, testInfo) => {
  test.setTimeout(0); // audit crawls 200+ URLs — no wall-clock limit

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

  // Attach listeners once — they fire on all navigations within this page
  attachConsoleListeners(page, bugs, viewport);
  attachNetworkListeners(page, bugs, viewport);

  for (const url of allUrls) {
    const navOk = await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).then(() => true).catch((err: Error) => {
      bugs.add({ ruleId: 'network:nav-failed', severity: 'high', bugClass: 'network',
        message: `Navigation failed: ${url} — ${err.message.split('\n')[0]}`, url, viewport });
      return false;
    });
    if (!navOk) { await page.waitForTimeout(CRAWL_DELAY_MS); continue; }

    await triggerLazyLoad(page);

    await runA11yCheck(page, bugs, viewport);
    await runSeoCheck(page, bugs, viewport);

    if (url.includes('/products/') || url.includes('/cart')) {
      await runRevenueCheck(page, bugs, viewport);
    }

    await runContentCheck(page, bugs, viewport);

    const slug = url.replace(/https?:\/\/[^/]+/, '').replace(/\//g, '-').slice(0, 60) || 'root';
    await takeScreenshot(page, slug, viewport).catch(() => {});

    await page.waitForTimeout(CRAWL_DELAY_MS);
  }
});
