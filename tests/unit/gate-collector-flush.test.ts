import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { createFindingCollector } from '../../src/findings/index.js';
import type { Finding, ElementCrop } from '../../src/types/finding.js';

let tmpRoot: string;
let seq = 0;
let prevEnable: string | undefined;

test.beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ryze-flush-gate-'));
  seq = 0;
  prevEnable = process.env.RYZE_ENABLE_GATE;
});
test.afterEach(() => {
  if (prevEnable === undefined) delete process.env.RYZE_ENABLE_GATE;
  else process.env.RYZE_ENABLE_GATE = prevEnable;
  rmSync(tmpRoot, { recursive: true, force: true });
});

function realCrop(): ElementCrop {
  const path = join(tmpRoot, `crop-${seq++}.png`);
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return { path, width: 10, height: 10, padding: 16, boundingBoxDrawn: true };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: `f-${seq}`,
    fingerprint: `fp-${seq}`,
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
}

function fakeClient(input: unknown): Anthropic {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'tool_use', name: 'submit_verdict', id: 't', input }] }),
    },
  } as unknown as Anthropic;
}

test('gate disabled (default): all findings written, no suppressed file, no mutation', async () => {
  delete process.env.RYZE_ENABLE_GATE;
  const path = join(tmpRoot, 'findings.jsonl');
  // Inject a client that would throw if the gate ran — proves it does not.
  const explodingClient = { messages: { create: async () => { throw new Error('gate ran!'); } } } as unknown as Anthropic;
  const collector = createFindingCollector(path, 'run-1', { client: explodingClient, retryDelayMs: 1 });
  collector.add(makeFinding({ id: 'a' }));
  collector.add(makeFinding({ id: 'b' }));
  await collector.flush();

  const lines = readFileSync(path, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(2);
  expect(existsSync(join(tmpRoot, 'suppressed-findings.jsonl'))).toBe(false);
  expect((JSON.parse(lines[0]!) as Finding).visualGate).toBeUndefined();
});

test('gate enabled + refuted high-confidence: finding suppressed from findings.jsonl, logged to sibling file', async () => {
  process.env.RYZE_ENABLE_GATE = '1';
  const path = join(tmpRoot, 'findings.jsonl');
  const collector = createFindingCollector(path, 'run-1', {
    client: fakeClient({ verdict: 'refuted', confidence: 0.95, reasoning: 'image renders fine' }),
    retryDelayMs: 1,
  });
  collector.add(makeFinding({ id: 'keep-me', severity: 'low' })); // out of scope → kept
  collector.add(makeFinding({ id: 'suppress-me', severity: 'high' }));
  await collector.flush();

  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const ids = lines.map((l) => (JSON.parse(l) as Finding).id);
  expect(ids).toEqual(['keep-me']); // suppress-me not written

  const suppressedPath = join(tmpRoot, 'suppressed-findings.jsonl');
  expect(existsSync(suppressedPath)).toBe(true);
  const suppressed = readFileSync(suppressedPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Finding);
  expect(suppressed.map((f) => f.id)).toEqual(['suppress-me']);

  // all() reflects the suppression too (suppressed finding removed)
  expect(collector.all().map((f) => f.id)).toEqual(['keep-me']);
});

test('gate enabled + confirmed: finding kept with visualGate populated', async () => {
  process.env.RYZE_ENABLE_GATE = '1';
  const path = join(tmpRoot, 'findings.jsonl');
  const collector = createFindingCollector(path, 'run-1', {
    client: fakeClient({ verdict: 'confirmed', confidence: 0.9, reasoning: 'really broken' }),
    retryDelayMs: 1,
  });
  collector.add(makeFinding({ id: 'c', severity: 'high' }));
  await collector.flush();

  const written = JSON.parse(readFileSync(path, 'utf8').trim()) as Finding;
  expect(written.id).toBe('c');
  expect(written.visualGate).toEqual({ verdict: 'visible', reason: 'really broken', judgeModel: 'claude-sonnet-4-6' });
  expect(existsSync(join(tmpRoot, 'suppressed-findings.jsonl'))).toBe(false);
});

test('gate enabled: incremental flush only gates the pending slice (idempotent)', async () => {
  process.env.RYZE_ENABLE_GATE = '1';
  const path = join(tmpRoot, 'findings.jsonl');
  const collector = createFindingCollector(path, 'run-1', {
    client: fakeClient({ verdict: 'confirmed', confidence: 0.9 }),
    retryDelayMs: 1,
  });
  collector.add(makeFinding({ id: 'first', severity: 'high' }));
  await collector.flush();
  collector.add(makeFinding({ id: 'second', severity: 'high' }));
  await collector.flush();
  await collector.flush(); // third flush: nothing new

  const lines = readFileSync(path, 'utf8').trim().split('\n');
  expect(lines.map((l) => (JSON.parse(l) as Finding).id)).toEqual(['first', 'second']);
});
