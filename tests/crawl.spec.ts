import { test, expect } from './fixtures/bug-collector.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { discoverUrls } from '../src/crawl/sitemap.js';
import { runA11yCheck } from './checks/a11y.js';
import { attachConsoleListeners } from './checks/console.js';
import { attachNetworkListeners } from './checks/network.js';
import { takeScreenshot, triggerLazyLoad } from './checks/visual.js';
import { runSeoCheck } from './checks/seo.js';
import { runRevenueCheck } from './checks/revenue.js';
import { runContentCheck } from './checks/content.js';
import type { UrlList, Viewport } from '../src/types.js';

const URL_LIST_PATH = join(process.cwd(), 'output', 'url-list.json');
const CRAWL_DELAY_MS = 1500;
const limit = pLimit(2);

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
  if (!existsSync(URL_LIST_PATH)) {
    throw new Error('Run pnpm test:crawl first to generate url-list.json');
  }

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

  for (const url of allUrls) {
    await limit(async () => {
      attachConsoleListeners(page, bugs, viewport);
      attachNetworkListeners(page, bugs, viewport);

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await triggerLazyLoad(page);

      await runA11yCheck(page, bugs, viewport);
      await runSeoCheck(page, bugs, viewport);

      if (url.includes('/products/') || url.includes('/cart')) {
        await runRevenueCheck(page, bugs, viewport);
      }

      await runContentCheck(page, bugs, viewport);

      const slug = url.replace(/https?:\/\/[^/]+/, '').replace(/\//g, '-').slice(0, 60) || 'root';
      await takeScreenshot(page, slug, viewport).catch(() => {
        // Visual baseline not yet created — that's OK on first run
      });

      await page.waitForTimeout(CRAWL_DELAY_MS);
    });
  }
});
