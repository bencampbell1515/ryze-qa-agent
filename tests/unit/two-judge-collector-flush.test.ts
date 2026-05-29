import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { createFindingCollector } from '../../src/findings/index.js';
import type { Finding, ElementCrop } from '../../src/types/finding.js';

const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';

let tmpRoot: string;
let seq = 0;
let prevGate: string | undefined;
let prevTwoJudge: string | undefined;

test.beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ryze-flush-2j-'));
  seq = 0;
  prevGate = process.env.RYZE_ENABLE_GATE;
  prevTwoJudge = process.env.RYZE_ENABLE_TWO_JUDGE;
});
test.afterEach(() => {
  if (prevGate === undefined) delete process.env.RYZE_ENABLE_GATE;
  else process.env.RYZE_ENABLE_GATE = prevGate;
  if (prevTwoJudge === undefined) delete process.env.RYZE_ENABLE_TWO_JUDGE;
  else process.env.RYZE_ENABLE_TWO_JUDGE = prevTwoJudge;
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

/** Client dispatching by requested model. */
function clientByModel(byModel: Record<string, unknown>): Anthropic {
  return {
    messages: {
      create: async ({ model }: { model: string }) => {
        const input = byModel[model];
        if (input === undefined) throw new Error('no mock for model ' + model);
        return { content: [{ type: 'tool_use', name: 'submit_verdict', id: 't', input }] };
      },
    },
  } as unknown as Anthropic;
}

test('two-judge enabled: J-uncertain finding whose judges both hedge → moved to uncertain-findings.jsonl, out of findings.jsonl and all()', async () => {
  process.env.RYZE_ENABLE_GATE = '1';
  process.env.RYZE_ENABLE_TWO_JUDGE = '1';
  const path = join(tmpRoot, 'findings.jsonl');
  const collector = createFindingCollector(path, 'run-1', {
    client: clientByModel({
      [SONNET]: { verdict: 'uncertain', confidence: 0.3 },
      [OPUS]: { verdict: 'uncertain', confidence: 0.4 },
    }),
    retryDelayMs: 1,
  });
  collector.add(makeFinding({ id: 'hedged', severity: 'high' }));
  await collector.flush();

  // not in the main stream
  expect(existsSync(path)).toBe(false);
  // in the uncertain sibling
  const uncertainPath = join(tmpRoot, 'uncertain-findings.jsonl');
  expect(existsSync(uncertainPath)).toBe(true);
  const unc = readFileSync(uncertainPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Finding);
  expect(unc.map((f) => f.id)).toEqual(['hedged']);
  expect(unc[0]!.visualGate!.verdict).toBe('uncertain');
  // dropped from in-memory main stream
  expect(collector.all().map((f) => f.id)).toEqual([]);
});

test('two-judge enabled: consensus confirmed → finding kept in findings.jsonl with both models recorded', async () => {
  process.env.RYZE_ENABLE_GATE = '1';
  process.env.RYZE_ENABLE_TWO_JUDGE = '1';
  const path = join(tmpRoot, 'findings.jsonl');
  const collector = createFindingCollector(path, 'run-1', {
    client: clientByModel({
      [SONNET]: { verdict: 'uncertain', confidence: 0.3 },
      [OPUS]: { verdict: 'confirmed', confidence: 0.9, reasoning: 'broken' },
    }),
    retryDelayMs: 1,
  });
  collector.add(makeFinding({ id: 'promoted', severity: 'high' }));
  await collector.flush();

  const written = JSON.parse(readFileSync(path, 'utf8').trim()) as Finding;
  expect(written.id).toBe('promoted');
  expect(written.visualGate!.verdict).toBe('visible');
  expect(written.visualGate!.judgeModel).toBe(`${SONNET}+${OPUS}`);
  expect(existsSync(join(tmpRoot, 'uncertain-findings.jsonl'))).toBe(false);
});

test('two-judge NOT enabled (gate only): J-uncertain finding stays in findings.jsonl, no uncertain file', async () => {
  process.env.RYZE_ENABLE_GATE = '1';
  delete process.env.RYZE_ENABLE_TWO_JUDGE;
  const path = join(tmpRoot, 'findings.jsonl');
  const collector = createFindingCollector(path, 'run-1', {
    // single judge (sonnet) returns uncertain
    client: clientByModel({ [SONNET]: { verdict: 'uncertain', confidence: 0.3 } }),
    retryDelayMs: 1,
  });
  collector.add(makeFinding({ id: 'stays', severity: 'high' }));
  await collector.flush();

  const written = JSON.parse(readFileSync(path, 'utf8').trim()) as Finding;
  expect(written.id).toBe('stays');
  expect(written.visualGate!.verdict).toBe('uncertain');
  expect(existsSync(join(tmpRoot, 'uncertain-findings.jsonl'))).toBe(false);
});
