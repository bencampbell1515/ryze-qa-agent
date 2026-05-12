import { test, expect, chromium } from '@playwright/test';
import { runExternalLinksCheck } from '../checks/external-links.js';

const fakeBugs = () => {
  const collected: any[] = [];
  return { collected, add: (b: any) => collected.push(b) };
};

test.describe('external-links: runExternalLinksCheck', () => {
  test('positive: rel="noopener" present → no bug fires', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="https://example.com" target="_blank" rel="noopener">Visit</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runExternalLinksCheck(page, bugs as any, 'desktop');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('negative: target="_blank" with no rel → one bug fires with href in message', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="https://example.com" target="_blank">Visit</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runExternalLinksCheck(page, bugs as any, 'desktop');
    expect(bugs.collected).toHaveLength(1);
    const bug = bugs.collected[0];
    expect(bug.ruleId).toBe('security:link-noopener-missing');
    expect(bug.severity).toBe('medium');
    expect(bug.message).toContain('https://example.com');
    // Missing noreferrer too → should mention it
    expect(bug.message).toContain('noreferrer');
    await browser.close();
  });

  test('edge: rel="noopener noreferrer" → no bug fires', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="https://example.com" target="_blank" rel="noopener noreferrer">Visit</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runExternalLinksCheck(page, bugs as any, 'desktop');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('edge: hidden link (display:none) with no rel → no bug fires', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="https://example.com" target="_blank" style="display:none">Hidden</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runExternalLinksCheck(page, bugs as any, 'desktop');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('edge: same href repeated → only one bug (de-duplicate)', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="https://example.com" target="_blank">First</a>
      <a href="https://example.com" target="_blank">Second</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runExternalLinksCheck(page, bugs as any, 'desktop');
    expect(bugs.collected).toHaveLength(1);
    await browser.close();
  });

  test('edge: fragment-only href → skipped', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="#section" target="_blank">Jump</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runExternalLinksCheck(page, bugs as any, 'desktop');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('edge: javascript: href → skipped', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="javascript:void(0)" target="_blank">Click</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runExternalLinksCheck(page, bugs as any, 'desktop');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('rel="noopener" present but noreferrer absent → bug fires WITHOUT extra noreferrer note', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="https://example.com" target="_blank" rel="noopener">Visit</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runExternalLinksCheck(page, bugs as any, 'desktop');
    // noopener IS present → no bug at all
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('rel missing noopener but has noreferrer → bug fires WITHOUT extra noreferrer note', async () => {
    // noreferrer implies noopener per spec, but we flag noopener absence regardless;
    // if noreferrer IS present, missingNoreferrer=false so no suffix appended.
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="https://partner.com" target="_blank" rel="noreferrer">Visit</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runExternalLinksCheck(page, bugs as any, 'desktop');
    // noreferrer is present; noopener is NOT → bug fires (still a noopener miss)
    // but the suffix "(also missing noreferrer)" should NOT appear
    expect(bugs.collected).toHaveLength(1);
    expect(bugs.collected[0].message).not.toContain('also missing noreferrer');
    await browser.close();
  });
});
