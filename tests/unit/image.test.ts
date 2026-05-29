import { test, expect, chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { runImageCheck } from '../checks/image.js';
import { createFindingCollector } from '../../src/findings/index.js';

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
    const findings = createFindingCollector(undefined, 'run-img'); // in-memory; never flushed
    await runImageCheck(page, bugs as any, 'desktop', { findings, runId: 'run-img' });
    expect(bugs.collected.find((b: any) => b.ruleId === 'content:empty-image-src')).toBeDefined();
    // worktree M2 dual-write: the same issue lands in the Finding stream.
    expect(findings.all().find((f) => f.ruleId === 'content:empty-image-src')).toBeDefined();
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
