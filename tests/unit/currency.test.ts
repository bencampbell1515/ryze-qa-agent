import { test, expect, chromium } from '@playwright/test';
import { runCurrencyCheck } from '../checks/currency.js';

const fakeBugs = () => {
  const collected: any[] = [];
  return { collected, add: (b: any) => collected.push(b) };
};

test('currency: mixed canonical and loose formats → content:currency-format-inconsistent', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><body>
    <div style="display:block; width:200px; height:50px;">
      <span class="price-canonical">$30.00</span>
      <span class="price-loose">$30</span>
    </div>
  </body></html>`);
  const bugs = fakeBugs();
  await runCurrencyCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'content:currency-format-inconsistent')).toBeDefined();
  await browser.close();
});

test('currency: all canonical prices → no bug', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><body>
    <div style="display:block; width:200px; height:50px;">
      <span>$30.00</span>
      <span>$1,234.56</span>
      <span>$0.99</span>
    </div>
  </body></html>`);
  const bugs = fakeBugs();
  await runCurrencyCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'content:currency-format-inconsistent')).toBeUndefined();
  await browser.close();
});

test('currency: all loose prices → no bug', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><body>
    <div style="display:block; width:200px; height:50px;">
      <span>$30</span>
      <span>$5</span>
    </div>
  </body></html>`);
  const bugs = fakeBugs();
  await runCurrencyCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'content:currency-format-inconsistent')).toBeUndefined();
  await browser.close();
});

test('currency: hidden prices not flagged', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><body>
    <div style="display:none;">
      <span>$30.00</span>
      <span>$30</span>
    </div>
  </body></html>`);
  const bugs = fakeBugs();
  await runCurrencyCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'content:currency-format-inconsistent')).toBeUndefined();
  await browser.close();
});

test('currency: other format (malformed) → content:currency-format-inconsistent', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><body>
    <div style="display:block; width:200px; height:50px;">
      <span>$30.00</span>
      <span>$1.2.3</span>
    </div>
  </body></html>`);
  const bugs = fakeBugs();
  await runCurrencyCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'content:currency-format-inconsistent')).toBeDefined();
  await browser.close();
});
