import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Viewport } from '../../src/types.js';

const VOLATILE_SELECTORS = [
  '.dynamic-banner',
  '[data-countdown]',
  '[data-timer]',
  '.announcement-bar',
  '.social-proof',
];

const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');

export async function triggerLazyLoad(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
}

export async function takeScreenshot(
  page: Page,
  snapshotName: string,
  viewport: Viewport,
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await triggerLazyLoad(page);

  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const maskLocators = VOLATILE_SELECTORS.map((sel) => page.locator(sel));

  // Pages taller than ~25k px produce 40MB+ screenshots that OOM-crash Chrome.
  // Fall back to viewport-height capture for those to keep the browser alive.
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
  const useFullPage = scrollHeight > 0 && scrollHeight <= 25000;

  await page.screenshot({
    path: join(SCREENSHOTS_DIR, `${snapshotName}-${viewport}.png`),
    fullPage: useFullPage,
    mask: maskLocators,
    maskColor: '#FF00FF',
  });
}
