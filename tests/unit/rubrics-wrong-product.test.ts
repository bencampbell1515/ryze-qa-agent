import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { evaluateRubric } from '../../src/rubrics/runner.js';
import { wrongProductRubric } from '../../src/rubrics/wrong-product.js';

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
  outDir = mkdtempSync(join(tmpdir(), 'ryze-wrongprod-'));
});
test.afterEach(async () => { await page.close(); rmSync(outDir, { recursive: true, force: true }); });

const DIM = 'product-matches-url-or-redirect-occurred';
function run(
  verdicts: RawVerdict[],
  pageContext: Record<string, string | number | boolean | null>,
) {
  return evaluateRubric(wrongProductRubric, {
    element: { kind: 'locator', locator: page.locator('#product-title') },
    pageContext,
    page,
    runId: 'r1',
    cropOutputDir: outDir,
    client: fakeClient(verdicts),
    retryDelayMs: 1,
  });
}

test('requested handle matches displayed product → pass', async () => {
  await page.setContent(`<h1 id="product-title" style="width:300px;height:40px">Mushroom Coffee</h1>`);
  const result = await run(
    [{ dimension: DIM, verdict: 'pass', confidence: 0.95 }],
    { url: 'https://www.ryzesuperfoods.com/products/mushroom-coffee', urlHandle: 'mushroom-coffee', redirected: false },
  );
  expect(result.finding).toBeNull();
});

test('redirected=true and displayed product differs → pass (by-design Shopify fallback)', async () => {
  await page.setContent(`<h1 id="product-title" style="width:300px;height:40px">Mushroom Matcha</h1>`);
  const result = await run(
    [{ dimension: DIM, verdict: 'pass', confidence: 0.9 }],
    { url: 'https://www.ryzesuperfoods.com/products/mushroom-matcha', urlHandle: 'discontinued-blend', redirected: true },
  );
  expect(result.finding).toBeNull();
});

test('redirected=false and displayed product differs → fail', async () => {
  await page.setContent(`<h1 id="product-title" style="width:300px;height:40px">Mushroom Matcha</h1>`);
  const result = await run(
    [{ dimension: DIM, verdict: 'fail', confidence: 0.92, discrepancy: 'URL handle mushroom-coffee but page shows Mushroom Matcha with no redirect' }],
    { url: 'https://www.ryzesuperfoods.com/products/mushroom-coffee', urlHandle: 'mushroom-coffee', redirected: false },
  );
  expect(result.finding).not.toBeNull();
  expect(result.finding!.ruleId).toBe('rubric:wrong-product-displayed');
  expect(result.finding!.severity).toBe('high');
  expect(result.finding!.description).toContain('no redirect');
});
