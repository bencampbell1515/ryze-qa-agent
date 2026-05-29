import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { evaluateRubric } from '../../src/rubrics/runner.js';
import type { Rubric } from '../../src/rubrics/types.js';

const RUBRIC: Rubric = {
  id: 'test-v1',
  label: 'Test rubric',
  context: 'A test element that should look a certain way.',
  ruleId: 'rubric:test-discrepancy',
  category: 'content',
  severity: 'high',
  dimensions: [
    { id: 'dim-a', description: 'first dimension' },
    { id: 'dim-b', description: 'second dimension' },
  ],
};

type RawVerdict = {
  dimension: string;
  verdict: string;
  confidence: number;
  discrepancy?: string;
};

/** Mock Anthropic client returning a forced tool_use block with the given verdicts. */
function fakeClient(verdicts: RawVerdict[], onCall?: (params: unknown) => void): Anthropic {
  return {
    messages: {
      create: async (params: unknown) => {
        onCall?.(params);
        return {
          content: [
            { type: 'tool_use', name: 'submit_verdicts', id: 'toolu_test', input: { verdicts } },
          ],
          stop_reason: 'tool_use',
        };
      },
    },
  } as unknown as Anthropic;
}

let browser: Browser;
let page: Page;
let outDir: string;

test.beforeAll(async ({ playwright }) => {
  browser = await playwright.chromium.launch();
});
test.afterAll(async () => {
  await browser.close();
});

test.beforeEach(async () => {
  // Pin a deterministic surface — no DSF/mobile emulation leaking from the project.
  page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  });
  outDir = mkdtempSync(join(tmpdir(), 'ryze-rubric-'));
});
test.afterEach(async () => {
  await page.close();
  rmSync(outDir, { recursive: true, force: true });
});

function visibleTarget() {
  return { kind: 'locator' as const, locator: page.locator('#el') };
}

const VISIBLE_HTML = `<div id="el" style="width:200px;height:60px;background:#eee">$24.99</div>`;
const HIDDEN_HTML = `<div id="el" style="display:none">$24.99</div>`;

test('all dimensions passing → finding is null but verdicts are returned', async () => {
  await page.setContent(VISIBLE_HTML);
  const client = fakeClient([
    { dimension: 'dim-a', verdict: 'pass', confidence: 0.95 },
    { dimension: 'dim-b', verdict: 'pass', confidence: 0.9 },
  ]);
  const result = await evaluateRubric(RUBRIC, {
    element: visibleTarget(),
    page,
    runId: 'r1',
    cropOutputDir: outDir,
    client,
    retryDelayMs: 1,
  });
  expect(result.finding).toBeNull();
  expect(result.verdicts).toHaveLength(2);
  expect(result.cropPath).not.toBe('');
  expect(existsSync(result.cropPath)).toBe(true);
});

test('one dimension failing → Finding with rubric metadata and verdicts', async () => {
  await page.setContent(VISIBLE_HTML);
  const client = fakeClient([
    { dimension: 'dim-a', verdict: 'pass', confidence: 0.9 },
    { dimension: 'dim-b', verdict: 'fail', confidence: 0.8, discrepancy: 'second dimension is wrong' },
  ]);
  const result = await evaluateRubric(RUBRIC, {
    element: visibleTarget(),
    page,
    runId: 'r1',
    cropOutputDir: outDir,
    client,
    retryDelayMs: 1,
  });
  const f = result.finding;
  expect(f).not.toBeNull();
  expect(f!.ruleId).toBe('rubric:test-discrepancy');
  expect(f!.category).toBe('content');
  expect(f!.severity).toBe('high');
  expect(f!.source).toBe('rubric');
  expect(f!.rubricVerdicts).toHaveLength(2);
  expect(f!.rubricVerdicts!.every((v) => v.rubricId === 'test-v1')).toBe(true);
  expect(f!.rubricVerdicts!.every((v) => v.judgeModel.length > 0)).toBe(true);
  expect(f!.description).toContain('second dimension is wrong');
  expect(f!.crop?.path).toBe(result.cropPath);
});

test('mixed failing dimensions → description uses the highest-confidence failure', async () => {
  await page.setContent(VISIBLE_HTML);
  const client = fakeClient([
    { dimension: 'dim-a', verdict: 'fail', confidence: 0.6, discrepancy: 'weak signal' },
    { dimension: 'dim-b', verdict: 'fail', confidence: 0.95, discrepancy: 'strong signal' },
  ]);
  const result = await evaluateRubric(RUBRIC, {
    element: visibleTarget(),
    page,
    runId: 'r1',
    cropOutputDir: outDir,
    client,
    retryDelayMs: 1,
  });
  expect(result.finding!.description).toContain('strong signal');
  // overall confidence = mean of the two failing confidences
  expect(result.finding!.confidence).toBeCloseTo((0.6 + 0.95) / 2, 5);
});

test('invisible element → null finding and the LLM is never called', async () => {
  await page.setContent(HIDDEN_HTML);
  let calls = 0;
  const client = fakeClient(
    [{ dimension: 'dim-a', verdict: 'fail', confidence: 1, discrepancy: 'x' }],
    () => { calls++; },
  );
  const result = await evaluateRubric(RUBRIC, {
    element: visibleTarget(),
    page,
    runId: 'r1',
    cropOutputDir: outDir,
    client,
    retryDelayMs: 1,
  });
  expect(result.finding).toBeNull();
  expect(result.verdicts).toEqual([]);
  expect(result.cropPath).toBe('');
  expect(calls).toBe(0);
});

test('malformed verdict (invalid enum) → throws with the raw output in the error', async () => {
  await page.setContent(VISIBLE_HTML);
  const client = fakeClient([
    { dimension: 'dim-a', verdict: 'banana', confidence: 0.5 },
  ]);
  await expect(
    evaluateRubric(RUBRIC, {
      element: visibleTarget(),
      page,
      runId: 'r1',
      cropOutputDir: outDir,
      client,
      retryDelayMs: 1,
    }),
  ).rejects.toThrow(/banana/);
});

test('persistent API failure → retries then returns a null finding (uncertain semantics)', async () => {
  await page.setContent(VISIBLE_HTML);
  let calls = 0;
  const client = {
    messages: {
      create: async () => {
        calls++;
        throw new Error('429 rate limited');
      },
    },
  } as unknown as Anthropic;
  const result = await evaluateRubric(RUBRIC, {
    element: visibleTarget(),
    page,
    runId: 'r1',
    cropOutputDir: outDir,
    client,
    retryDelayMs: 1,
  });
  expect(result.finding).toBeNull();
  expect(result.verdicts).toEqual([]);
  expect(calls).toBe(3); // 3 retry attempts per the shared withRetries default
});
