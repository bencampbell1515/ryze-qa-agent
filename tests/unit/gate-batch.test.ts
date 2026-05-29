import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { runGateBatch } from '../../src/gate/batch.js';
import type { Finding, ElementCrop } from '../../src/types/finding.js';

let tmpRoot: string;
let cropSeq = 0;

test.beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ryze-gate-batch-'));
  cropSeq = 0;
});
test.afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** A real on-disk crop file so evaluateGate proceeds to the (mocked) LLM. */
function realCrop(): ElementCrop {
  const path = join(tmpRoot, `crop-${cropSeq++}.png`);
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return { path, width: 10, height: 10, padding: 16, boundingBoxDrawn: true };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  const f: Finding = {
    id: `f-run-${cropSeq}`,
    fingerprint: `fp-${cropSeq}`,
    runId: 'run-1',
    discoveredAt: '2026-05-29T00:00:00.000Z',
    ruleId: 'content:broken-image',
    category: 'content',
    source: 'deterministic',
    severity: 'high',
    url: 'https://www.ryzesuperfoods.com/products/x',
    title: 'Broken image',
    description: 'Image failed to load.',
    confidence: 0.9,
    crop: realCrop(),
    ...overrides,
  };
  // Keep ids unique per finding even when overrides omit id.
  if (!overrides.id) f.id = `f-run-${cropSeq}`;
  return f;
}

/** Fake client returning a fixed verdict for every call; counts calls. */
function fakeClient(input: unknown): { client: Anthropic; calls: () => number } {
  let n = 0;
  const client = {
    messages: {
      create: async () => {
        n++;
        return { content: [{ type: 'tool_use', name: 'submit_verdict', id: 'toolu', input }] };
      },
    },
  } as unknown as Anthropic;
  return { client, calls: () => n };
}

const baseConfig = (client: Anthropic, extra = {}) => ({
  client,
  retryDelayMs: 1,
  suppressedPath: join(tmpRoot, 'suppressed.jsonl'),
  ...extra,
});

test('only in-scope (critical/high) findings are gated; out-of-scope pass through', async () => {
  const { client, calls } = fakeClient({ verdict: 'confirmed', confidence: 0.9 });
  const findings = [
    makeFinding({ severity: 'critical' }),
    makeFinding({ severity: 'high' }),
    makeFinding({ severity: 'high' }),
    makeFinding({ severity: 'medium' }),
    makeFinding({ severity: 'low' }),
  ];
  const { kept, suppressed } = await runGateBatch(findings, baseConfig(client));
  expect(calls()).toBe(3); // only the 3 critical/high findings hit the LLM
  expect(kept).toHaveLength(5); // confirmed in-scope + untouched out-of-scope
  expect(suppressed).toHaveLength(0);
});

test('all in-scope confirmed → kept=all, suppressed=0', async () => {
  const { client } = fakeClient({ verdict: 'confirmed', confidence: 0.95 });
  const findings = [makeFinding(), makeFinding(), makeFinding({ severity: 'low' })];
  const { kept, suppressed } = await runGateBatch(findings, baseConfig(client));
  expect(kept).toHaveLength(3);
  expect(suppressed).toHaveLength(0);
  // confirmed findings carry a 'visible' visualGate
  const gated = kept.filter((f) => f.severity !== 'low');
  expect(gated.every((f) => f.visualGate?.verdict === 'visible')).toBe(true);
});

test('one in-scope refuted high-confidence → suppressed', async () => {
  const { client } = fakeClient({ verdict: 'refuted', confidence: 0.92, reasoning: 'title is visible' });
  const findings = [
    makeFinding({ severity: 'high' }),
    makeFinding({ severity: 'low' }),
    makeFinding({ severity: 'medium' }),
    makeFinding({ severity: 'low' }),
    makeFinding({ severity: 'medium' }),
  ];
  const { kept, suppressed } = await runGateBatch(findings, baseConfig(client));
  expect(suppressed).toHaveLength(1);
  expect(kept).toHaveLength(4);
});

test('suppressed findings record the gate reason in meta for reviewer auditability', async () => {
  const { client } = fakeClient({ verdict: 'refuted', confidence: 0.93, reasoning: 'title is clearly present' });
  const { suppressed } = await runGateBatch([makeFinding({ severity: 'high', id: 'sup' })], baseConfig(client));
  expect(suppressed).toHaveLength(1);
  expect(suppressed[0]!.meta?.gateVerdict).toBe('refuted');
  expect(suppressed[0]!.meta?.gateReason).toBe('title is clearly present');
  expect(suppressed[0]!.meta?.gateConfidence).toBe(0.93);
});

test('excludeCategories filter skips matching findings (no LLM call)', async () => {
  const { client, calls } = fakeClient({ verdict: 'refuted', confidence: 0.9 });
  const findings = [
    makeFinding({ severity: 'high', category: 'seo', ruleId: 'seo:missing-title' }),
    makeFinding({ severity: 'high', category: 'content' }),
  ];
  const { kept, suppressed } = await runGateBatch(findings, baseConfig(client, { excludeCategories: ['seo'] }));
  expect(calls()).toBe(1); // only the content finding gated
  expect(suppressed).toHaveLength(1); // content refuted
  expect(kept).toHaveLength(1); // seo passed through unchanged
  expect(kept[0]!.category).toBe('seo');
});

test('excludeSources defaults to skip rubric findings', async () => {
  const { client, calls } = fakeClient({ verdict: 'refuted', confidence: 0.9 });
  const findings = [
    makeFinding({ severity: 'high', source: 'rubric' }),
    makeFinding({ severity: 'high', source: 'deterministic' }),
  ];
  const { kept } = await runGateBatch(findings, baseConfig(client));
  expect(calls()).toBe(1); // rubric finding skipped, only deterministic gated
  expect(kept.some((f) => f.source === 'rubric')).toBe(true); // rubric passed through
});

test('findings with pre-populated visualGate are skipped (no LLM call)', async () => {
  const { client, calls } = fakeClient({ verdict: 'refuted', confidence: 0.9 });
  const findings = [
    makeFinding({ severity: 'high', visualGate: { verdict: 'visible', reason: 'pre-confirmed', judgeModel: 'n/a' } }),
    makeFinding({ severity: 'high' }),
  ];
  const { kept } = await runGateBatch(findings, baseConfig(client));
  expect(calls()).toBe(1); // pre-gated finding skipped
  expect(kept).toHaveLength(1); // the deterministic one was refuted+suppressed
});

test('suppressed findings are written to suppressedPath as parseable JSONL', async () => {
  const { client } = fakeClient({ verdict: 'refuted', confidence: 0.9, reasoning: 'not a real bug' });
  const suppressedPath = join(tmpRoot, 'suppressed.jsonl');
  const findings = [makeFinding({ severity: 'high', id: 'f-suppress-me' })];
  await runGateBatch(findings, baseConfig(client, { suppressedPath }));
  expect(existsSync(suppressedPath)).toBe(true);
  const lines = readFileSync(suppressedPath, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0]!) as Finding;
  expect(parsed.id).toBe('f-suppress-me');
});

test('no suppressed findings → suppressedPath file is not created', async () => {
  const { client } = fakeClient({ verdict: 'confirmed', confidence: 0.9 });
  const suppressedPath = join(tmpRoot, 'suppressed.jsonl');
  await runGateBatch([makeFinding({ severity: 'high' })], baseConfig(client, { suppressedPath }));
  expect(existsSync(suppressedPath)).toBe(false);
});

test('concurrency limit is respected', async () => {
  let active = 0;
  let maxActive = 0;
  const client = {
    messages: {
      create: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return { content: [{ type: 'tool_use', name: 'submit_verdict', id: 't', input: { verdict: 'confirmed', confidence: 0.9 } }] };
      },
    },
  } as unknown as Anthropic;

  const findings = Array.from({ length: 8 }, () => makeFinding({ severity: 'high' }));
  await runGateBatch(findings, baseConfig(client, { concurrency: 3 }));
  expect(maxActive).toBeLessThanOrEqual(3);
  expect(maxActive).toBeGreaterThan(1); // sanity: it did run in parallel
});

test('finding with no crop → uncertain, kept (not suppressed)', async () => {
  const { client, calls } = fakeClient({ verdict: 'refuted', confidence: 0.99 });
  const noCrop = makeFinding({ severity: 'high' });
  delete noCrop.crop;
  const { kept, suppressed } = await runGateBatch([noCrop], baseConfig(client));
  expect(calls()).toBe(0); // no crop → no LLM call
  expect(suppressed).toHaveLength(0);
  expect(kept).toHaveLength(1);
  expect(kept[0]!.visualGate?.verdict).toBe('uncertain');
});
