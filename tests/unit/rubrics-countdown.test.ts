import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { evaluateRubric } from '../../src/rubrics/runner.js';
import { countdownTimerRubric } from '../../src/rubrics/countdown-timer.js';

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
  outDir = mkdtempSync(join(tmpdir(), 'ryze-countdown-'));
});
test.afterEach(async () => { await page.close(); rmSync(outDir, { recursive: true, force: true }); });

const DIM = 'timer-state-matches-offer-state';
function run(verdicts: RawVerdict[]) {
  return evaluateRubric(countdownTimerRubric, {
    element: { kind: 'locator', locator: page.locator('#timer') },
    pageContext: { url: 'https://www.ryzesuperfoods.com/' },
    page,
    runId: 'r1',
    cropOutputDir: outDir,
    client: fakeClient(verdicts),
    retryDelayMs: 1,
  });
}

test('00:00:00 with no active offer messaging → pass (no finding)', async () => {
  await page.setContent(`<div id="timer" style="width:160px;height:40px">00:00:00</div>`);
  const result = await run([{ dimension: DIM, verdict: 'pass', confidence: 0.95 }]);
  expect(result.finding).toBeNull();
  expect(result.verdicts).toHaveLength(1);
});

test('12:34:56 with an active offer → pass (no finding)', async () => {
  await page.setContent(`<div id="timer" style="width:160px;height:40px">12:34:56</div><button>Buy Now</button>`);
  const result = await run([{ dimension: DIM, verdict: 'pass', confidence: 0.9 }]);
  expect(result.finding).toBeNull();
});

test('00:00:00 while "Sale ends in" is still displayed → fail (finding emitted)', async () => {
  await page.setContent(`<div>Sale ends in</div><div id="timer" style="width:160px;height:40px">00:00:00</div><button>Buy Now</button>`);
  const result = await run([
    { dimension: DIM, verdict: 'fail', confidence: 0.9, discrepancy: 'Timer frozen at 00:00:00 but "Sale ends in" + Buy Now still shown' },
  ]);
  expect(result.finding).not.toBeNull();
  expect(result.finding!.ruleId).toBe('rubric:countdown-timer-broken');
  expect(result.finding!.severity).toBe('medium');
  expect(result.finding!.description).toContain('frozen at 00:00:00');
});

test('schema: ruleId is namespaced under "rubric:" and category is content', () => {
  expect(countdownTimerRubric.ruleId.startsWith('rubric:')).toBe(true);
  expect(countdownTimerRubric.category).toBe('content');
  expect(countdownTimerRubric.dimensions.length).toBeGreaterThan(0);
});
