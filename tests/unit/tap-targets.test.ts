import { test, expect, chromium } from '@playwright/test';
import { runTapTargetsCheck } from '../checks/tap-targets.js';

const fakeBugs = () => {
  const collected: any[] = [];
  return { collected, add: (b: any) => collected.push(b) };
};

test.describe('tap-targets: runTapTargetsCheck', () => {
  test('bug fires: 20×20 <button> on mobile → flagged', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<!DOCTYPE html><html><body>
      <button style="width:20px;height:20px;display:block;">X</button>
    </body></html>`);
    const bugs = fakeBugs();
    await runTapTargetsCheck(page, bugs as any, 'mobile');
    expect(bugs.collected.length).toBeGreaterThanOrEqual(1);
    const bug = bugs.collected[0];
    expect(bug.ruleId).toBe('content:tap-target-too-small');
    expect(bug.severity).toBe('medium');
    expect(bug.message).toContain('mobile');
    await browser.close();
  });

  test('no bug: 40×40 <button> on mobile → no flag', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<!DOCTYPE html><html><body>
      <button style="width:40px;height:40px;display:block;">OK</button>
    </body></html>`);
    const bugs = fakeBugs();
    await runTapTargetsCheck(page, bugs as any, 'mobile');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('no bug: 20×20 <button> on desktop → early return, no flag', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setContent(`<!DOCTYPE html><html><body>
      <button style="width:20px;height:20px;display:block;">X</button>
    </body></html>`);
    const bugs = fakeBugs();
    await runTapTargetsCheck(page, bugs as any, 'desktop');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('no bug: 20×20 <button> on tablet → early return, no flag', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.setContent(`<!DOCTYPE html><html><body>
      <button style="width:20px;height:20px;display:block;">X</button>
    </body></html>`);
    const bugs = fakeBugs();
    await runTapTargetsCheck(page, bugs as any, 'tablet');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('no bug: 20×20 <a> inside a <nav><li> where <li> is 100×40 → ancestor hoist skips it', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    // The <a> itself is tiny but the <li> wrapper is the actual tap area (100×40px).
    // cursor:pointer on the <li> to trigger ancestor hoist.
    await page.setContent(`<!DOCTYPE html><html><body>
      <nav>
        <ul style="list-style:none;margin:0;padding:0;">
          <li style="width:100px;height:40px;cursor:pointer;display:block;">
            <a href="/about" style="width:20px;height:20px;display:inline-block;">About</a>
          </li>
        </ul>
      </nav>
    </body></html>`);
    const bugs = fakeBugs();
    await runTapTargetsCheck(page, bugs as any, 'mobile');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('no bug: href="#" anchor → decorative, skipped', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="#" style="width:10px;height:10px;display:inline-block;">Scroll</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runTapTargetsCheck(page, bugs as any, 'mobile');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('bug fires: <a href="/page"> at 25×15 on mobile → flagged', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<!DOCTYPE html><html><body>
      <a href="/some-page" style="width:25px;height:15px;display:inline-block;">Go</a>
    </body></html>`);
    const bugs = fakeBugs();
    await runTapTargetsCheck(page, bugs as any, 'mobile');
    expect(bugs.collected.length).toBeGreaterThanOrEqual(1);
    expect(bugs.collected[0].ruleId).toBe('content:tap-target-too-small');
    await browser.close();
  });

  test('no bug: hidden button (display:none) on mobile → not visible, skipped', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<!DOCTYPE html><html><body>
      <button style="width:20px;height:20px;display:none;">Hidden</button>
    </body></html>`);
    const bugs = fakeBugs();
    await runTapTargetsCheck(page, bugs as any, 'mobile');
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });

  test('no bug: <input type="checkbox"> inside a 40×40 label (cursor:pointer) → ancestor hoist', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<!DOCTYPE html><html><body>
      <label style="width:40px;height:40px;display:inline-block;cursor:pointer;">
        <input type="checkbox" style="width:16px;height:16px;" />
        Accept
      </label>
    </body></html>`);
    const bugs = fakeBugs();
    await runTapTargetsCheck(page, bugs as any, 'mobile');
    // The label wraps the checkbox with pointer cursor and adequate size
    expect(bugs.collected).toHaveLength(0);
    await browser.close();
  });
});
