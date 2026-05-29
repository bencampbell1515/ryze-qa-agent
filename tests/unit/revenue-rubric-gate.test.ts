import { test, expect, chromium, type Browser } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { runRevenueCheck } from '../checks/revenue.js';
import { createFindingCollector } from '../../src/findings/index.js';
import type { BugInstance } from '../../src/types.js';
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

function fakeBugs() {
  const collected: Array<Omit<BugInstance, 'timestamp'>> = [];
  return { collected, add: (b: Omit<BugInstance, 'timestamp'>) => collected.push(b) };
}

// A /cart page with a visible line item, an enabled checkout button, and NO
// subtotal element — so the deterministic check would fire revenue:cart-subtotal-missing.
const CART_HTML =
  '<!DOCTYPE html><html><body>' +
  '<div class="cart" style="width:320px">' +
  '<div class="cart-item" style="display:block;width:240px;height:48px"><a href="/products/x">Item</a></div>' +
  '<button name="checkout">Checkout</button>' +
  '</div></body></html>';

function startServer(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(CART_HTML); });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
    server.unref();
  });
}

let browser: Browser;
let outDir: string;
let savedEnv: { enable?: string; key?: string };

test.beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
test.afterAll(async () => { await browser.close(); });
test.beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'ryze-gate-'));
  savedEnv = { enable: process.env.RYZE_ENABLE_RUBRICS, key: process.env.ANTHROPIC_API_KEY };
  process.env.RYZE_RUBRIC_CROP_DIR = outDir;
});
test.afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
  if (savedEnv.enable === undefined) delete process.env.RYZE_ENABLE_RUBRICS; else process.env.RYZE_ENABLE_RUBRICS = savedEnv.enable;
  if (savedEnv.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedEnv.key;
  delete process.env.RYZE_RUBRIC_CROP_DIR;
});

test('gate ON, rubric PASS → cart-subtotal FP suppressed in BOTH streams', async () => {
  process.env.RYZE_ENABLE_RUBRICS = '1';
  process.env.ANTHROPIC_API_KEY = 'test';
  const { server, base } = await startServer();
  const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  page.setDefaultTimeout(3000);
  try {
    await page.goto(`${base}/cart`, { waitUntil: 'load' });
    const findings = createFindingCollector(join(outDir, 'f.jsonl'), 'run-g');
    const bugs = fakeBugs();
    const ctx: DualWriteContext = { findings, runId: 'run-g', rubricClient: fakeClient([{ dimension: 'subtotal-visible-as-currency', verdict: 'pass', confidence: 0.96 }]) };
    await runRevenueCheck(page, bugs as never, 'desktop', ctx);

    expect(bugs.collected.find((b) => b.ruleId === 'revenue:cart-subtotal-missing')).toBeUndefined();
    expect(findings.all().find((f) => f.ruleId.includes('cart-subtotal'))).toBeUndefined();
  } finally {
    await page.close(); server.closeAllConnections?.(); server.close();
  }
});

test('gate ON, rubric FAIL → deterministic bug emitted AND rubric finding emitted', async () => {
  process.env.RYZE_ENABLE_RUBRICS = '1';
  process.env.ANTHROPIC_API_KEY = 'test';
  const { server, base } = await startServer();
  const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  page.setDefaultTimeout(3000);
  try {
    await page.goto(`${base}/cart`, { waitUntil: 'load' });
    const findings = createFindingCollector(join(outDir, 'f.jsonl'), 'run-g');
    const bugs = fakeBugs();
    const ctx: DualWriteContext = { findings, runId: 'run-g', rubricClient: fakeClient([{ dimension: 'subtotal-visible-as-currency', verdict: 'fail', confidence: 0.9, discrepancy: 'no currency value visible' }]) };
    await runRevenueCheck(page, bugs as never, 'desktop', ctx);

    // Deterministic bug still in bugs.jsonl.
    expect(bugs.collected.find((b) => b.ruleId === 'revenue:cart-subtotal-missing')).toBeDefined();
    // Rubric finding (source: rubric) added to the Finding stream.
    const rf = findings.all().find((f) => f.ruleId === 'rubric:cart-subtotal-missing');
    expect(rf).toBeDefined();
    expect(rf!.source).toBe('rubric');
  } finally {
    await page.close(); server.closeAllConnections?.(); server.close();
  }
});

test('gate OFF (flag unset) → deterministic bug emitted as today, no rubric finding, LLM never called', async () => {
  delete process.env.RYZE_ENABLE_RUBRICS;
  process.env.ANTHROPIC_API_KEY = 'test';
  const { server, base } = await startServer();
  const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  page.setDefaultTimeout(3000);
  let calls = 0;
  try {
    await page.goto(`${base}/cart`, { waitUntil: 'load' });
    const findings = createFindingCollector(join(outDir, 'f.jsonl'), 'run-g');
    const bugs = fakeBugs();
    const ctx: DualWriteContext = { findings, runId: 'run-g', rubricClient: fakeClient([{ dimension: 'subtotal-visible-as-currency', verdict: 'pass', confidence: 1 }], () => { calls++; }) };
    await runRevenueCheck(page, bugs as never, 'desktop', ctx);

    expect(bugs.collected.find((b) => b.ruleId === 'revenue:cart-subtotal-missing')).toBeDefined();
    expect(findings.all().find((f) => f.ruleId === 'rubric:cart-subtotal-missing')).toBeUndefined();
    expect(calls).toBe(0);
  } finally {
    await page.close(); server.closeAllConnections?.(); server.close();
  }
});
