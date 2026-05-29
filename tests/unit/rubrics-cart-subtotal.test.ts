import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { evaluateRubric } from '../../src/rubrics/runner.js';
import { cartSubtotalRubric } from '../../src/rubrics/cart-subtotal.js';

type RawVerdict = { dimension: string; verdict: string; confidence: number; discrepancy?: string };

function fakeClient(verdicts: RawVerdict[]): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'tool_use', name: 'submit_verdicts', id: 't', input: { verdicts } }],
        stop_reason: 'tool_use',
      }),
    },
  } as unknown as Anthropic;
}

let browser: Browser;
let page: Page;
let outDir: string;

test.beforeAll(async ({ playwright }) => { browser = await playwright.chromium.launch(); });
test.afterAll(async () => { await browser.close(); });
test.beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  outDir = mkdtempSync(join(tmpdir(), 'ryze-subtotal-'));
});
test.afterEach(async () => { await page.close(); rmSync(outDir, { recursive: true, force: true }); });

const DIM = 'subtotal-visible-as-currency';
function run(verdicts: RawVerdict[]) {
  return evaluateRubric(cartSubtotalRubric, {
    element: { kind: 'locator', locator: page.locator('#cart-summary') },
    pageContext: { url: 'https://www.ryzesuperfoods.com/cart' },
    page,
    runId: 'r1',
    cropOutputDir: outDir,
    client: fakeClient(verdicts),
    retryDelayMs: 1,
  });
}

test('cart with a visible "$24.99" subtotal → pass (suppresses the deterministic FP)', async () => {
  await page.setContent(`<div id="cart-summary" style="width:300px;height:80px">Subtotal <span>$24.99</span></div>`);
  const result = await run([{ dimension: DIM, verdict: 'pass', confidence: 0.96 }]);
  expect(result.finding).toBeNull();
});

test('cart with no currency-formatted value visible → fail', async () => {
  await page.setContent(`<div id="cart-summary" style="width:300px;height:80px">Your cart</div>`);
  const result = await run([
    { dimension: DIM, verdict: 'fail', confidence: 0.9, discrepancy: 'No currency value in cart summary' },
  ]);
  expect(result.finding).not.toBeNull();
  expect(result.finding!.ruleId).toBe('rubric:cart-subtotal-missing');
  expect(result.finding!.category).toBe('revenue');
  expect(result.finding!.severity).toBe('high');
});

test('cart whose subtotal is display:none → fail (value not visible to shopper)', async () => {
  // The cart-summary container is visible (croppable); the subtotal child is hidden.
  await page.setContent(`<div id="cart-summary" style="width:300px;height:80px">Subtotal <span style="display:none">$24.99</span></div>`);
  const result = await run([
    { dimension: DIM, verdict: 'fail', confidence: 0.85, discrepancy: 'Subtotal value is hidden (display:none)' },
  ]);
  expect(result.finding).not.toBeNull();
  expect(result.finding!.description).toContain('hidden');
});
