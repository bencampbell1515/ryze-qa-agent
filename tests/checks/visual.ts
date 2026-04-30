import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { Viewport } from '../../src/types.js';

const VOLATILE_SELECTORS = [
  '.dynamic-banner',
  '[data-countdown]',
  '[data-timer]',
  '.announcement-bar',
  '.social-proof',
];

/**
 * Trigger Shopify lazy-load by scrolling to bottom and back.
 */
export async function triggerLazyLoad(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Take a full-page screenshot with volatile regions masked.
 * On first run, creates the baseline. On subsequent runs, diffs against it.
 */
export async function takeScreenshot(
  page: Page,
  snapshotName: string,
  viewport: Viewport,
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await triggerLazyLoad(page);

  const maskLocators = VOLATILE_SELECTORS.map((sel) => page.locator(sel));

  await expect(page).toHaveScreenshot(`${snapshotName}-${viewport}.png`, {
    fullPage: true,
    mask: maskLocators,
    maskColor: '#FF00FF',
  });
}
