import { test, expect, chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { runImageCheck } from '../checks/image.js';

const fakeBugs = () => {
  const collected: any[] = [];
  return { collected, add: (b: any) => collected.push(b) };
};

test.describe('image: runImageCheck', () => {
  test('empty-src visible <img> → content:empty-image-src fires', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, isMobile: false });
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
      <img src="" style="display:block;width:120px;height:90px;background:#cccccc">
    </body></html>`);
    const bugs = fakeBugs();
    await runImageCheck(page, bugs as any, 'desktop');
    expect(bugs.collected.find((b: any) => b.ruleId === 'content:empty-image-src')).toBeDefined();
    await browser.close();
  });

  test('crop: flagged broken image carries a tight element crop (elementScreenshot set + file exists)', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, isMobile: false });
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
      <img src="" style="display:block;width:120px;height:90px;background:#cccccc">
    </body></html>`);
    const bugs = fakeBugs();
    await runImageCheck(page, bugs as any, 'desktop');
    const bug = bugs.collected.find((b: any) => b.ruleId === 'content:empty-image-src');
    expect(bug).toBeDefined();
    expect(typeof bug.elementScreenshot).toBe('string');
    expect(existsSync(bug.elementScreenshot)).toBe(true);
    await browser.close();
  });
});
