import { test, expect, type Browser, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { runCountdownRubricCheck, runWrongProductRubricCheck } from '../checks/rubric-checks.js';
import { createFindingCollector } from '../../src/findings/index.js';
import type { DualWriteContext } from '../checks/_emit.js';

type RawVerdict = { dimension: string; verdict: string; confidence: number; discrepancy?: string };

function fakeClient(verdicts: RawVerdict[], onCall?: () => void): Anthropic {
  return {
    messages: {
      create: async () => {
        onCall?.();
        return {
          content: [{ type: 'tool_use', name: 'submit_verdicts', id: 't', input: { verdicts } }],
          stop_reason: 'tool_use',
        };
      },
    },
  } as unknown as Anthropic;
}

let browser: Browser;
let page: Page;
let outDir: string;
let savedEnv: { enable?: string; key?: string };

test.beforeAll(async ({ playwright }) => { browser = await playwright.chromium.launch(); });
test.afterAll(async () => { await browser.close(); });
test.beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  outDir = mkdtempSync(join(tmpdir(), 'ryze-rcheck-'));
  savedEnv = { enable: process.env.RYZE_ENABLE_RUBRICS, key: process.env.ANTHROPIC_API_KEY };
  process.env.RYZE_RUBRIC_CROP_DIR = outDir;
});
test.afterEach(async () => {
  await page.close();
  rmSync(outDir, { recursive: true, force: true });
  if (savedEnv.enable === undefined) delete process.env.RYZE_ENABLE_RUBRICS; else process.env.RYZE_ENABLE_RUBRICS = savedEnv.enable;
  if (savedEnv.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedEnv.key;
  delete process.env.RYZE_RUBRIC_CROP_DIR;
});

function ctxWith(client: Anthropic): DualWriteContext {
  return { findings: createFindingCollector(join(outDir, 'f.jsonl'), 'run-x'), runId: 'run-x', rubricClient: client };
}

// ── Countdown standalone check ──────────────────────────────────────────────

test('countdown: enabled + visible timer + fail verdict → rubric finding added', async () => {
  process.env.RYZE_ENABLE_RUBRICS = '1';
  process.env.ANTHROPIC_API_KEY = 'test';
  await page.setContent(`<div>Sale ends in</div><div class="countdown" style="width:160px;height:40px">00:00:00</div>`);
  const ctx = ctxWith(fakeClient([{ dimension: 'timer-state-matches-offer-state', verdict: 'fail', confidence: 0.9, discrepancy: 'frozen but offer live' }]));
  await runCountdownRubricCheck(page, ctx);
  const f = ctx.findings!.all().find((x) => x.ruleId === 'rubric:countdown-timer-broken');
  expect(f).toBeDefined();
  expect(f!.source).toBe('rubric');
});

test('countdown: disabled (flag unset) → no finding, LLM never called', async () => {
  delete process.env.RYZE_ENABLE_RUBRICS;
  process.env.ANTHROPIC_API_KEY = 'test';
  await page.setContent(`<div class="countdown" style="width:160px;height:40px">00:00:00</div>`);
  let calls = 0;
  const ctx = ctxWith(fakeClient([{ dimension: 'timer-state-matches-offer-state', verdict: 'fail', confidence: 1 }], () => { calls++; }));
  await runCountdownRubricCheck(page, ctx);
  expect(ctx.findings!.all()).toHaveLength(0);
  expect(calls).toBe(0);
});

test('countdown: no timer element on page → no finding, LLM never called', async () => {
  process.env.RYZE_ENABLE_RUBRICS = '1';
  process.env.ANTHROPIC_API_KEY = 'test';
  await page.setContent(`<div>No timer here</div>`);
  let calls = 0;
  const ctx = ctxWith(fakeClient([{ dimension: 'timer-state-matches-offer-state', verdict: 'fail', confidence: 1 }], () => { calls++; }));
  await runCountdownRubricCheck(page, ctx);
  expect(ctx.findings!.all()).toHaveLength(0);
  expect(calls).toBe(0);
});

// ── Wrong-product standalone check ──────────────────────────────────────────

function startServer(html: string): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
    server.unref();
  });
}

const PRODUCT_HTML = '<!DOCTYPE html><html><body><h1 class="product__title" style="width:300px;height:40px">Mushroom Matcha</h1></body></html>';

test('wrong-product: /products/ + redirected=false + fail verdict → rubric finding added', async () => {
  process.env.RYZE_ENABLE_RUBRICS = '1';
  process.env.ANTHROPIC_API_KEY = 'test';
  const { server, base } = await startServer(PRODUCT_HTML);
  try {
    await page.goto(`${base}/products/mushroom-coffee`, { waitUntil: 'load' });
    const ctx = ctxWith(fakeClient([{ dimension: 'product-matches-url-or-redirect-occurred', verdict: 'fail', confidence: 0.9, discrepancy: 'handle mushroom-coffee but shows Mushroom Matcha, no redirect' }]));
    await runWrongProductRubricCheck(page, ctx, { requestedUrl: `${base}/products/mushroom-coffee`, redirected: false });
    const f = ctx.findings!.all().find((x) => x.ruleId === 'rubric:wrong-product-displayed');
    expect(f).toBeDefined();
    expect(f!.source).toBe('rubric');
  } finally {
    server.closeAllConnections?.(); server.close();
  }
});

test('wrong-product: non-/products/ URL → skipped, LLM never called', async () => {
  process.env.RYZE_ENABLE_RUBRICS = '1';
  process.env.ANTHROPIC_API_KEY = 'test';
  const { server, base } = await startServer(PRODUCT_HTML);
  try {
    await page.goto(`${base}/pages/about`, { waitUntil: 'load' });
    let calls = 0;
    const ctx = ctxWith(fakeClient([{ dimension: 'product-matches-url-or-redirect-occurred', verdict: 'fail', confidence: 1 }], () => { calls++; }));
    await runWrongProductRubricCheck(page, ctx, { requestedUrl: `${base}/pages/about`, redirected: false });
    expect(ctx.findings!.all()).toHaveLength(0);
    expect(calls).toBe(0);
  } finally {
    server.closeAllConnections?.(); server.close();
  }
});

test('wrong-product: redirected=true + pass verdict → no finding (by-design fallback)', async () => {
  process.env.RYZE_ENABLE_RUBRICS = '1';
  process.env.ANTHROPIC_API_KEY = 'test';
  const { server, base } = await startServer(PRODUCT_HTML);
  try {
    await page.goto(`${base}/products/mushroom-matcha`, { waitUntil: 'load' });
    const ctx = ctxWith(fakeClient([{ dimension: 'product-matches-url-or-redirect-occurred', verdict: 'pass', confidence: 0.95 }]));
    await runWrongProductRubricCheck(page, ctx, { requestedUrl: `${base}/products/discontinued`, redirected: true });
    expect(ctx.findings!.all()).toHaveLength(0);
  } finally {
    server.closeAllConnections?.(); server.close();
  }
});
