import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { runTwoJudge } from '../../src/gate/two-judge.js';
import type { Finding } from '../../src/types/finding.js';

const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-run-1-deadbeef',
    fingerprint: 'deadbeef',
    runId: 'run-1',
    discoveredAt: '2026-05-29T00:00:00.000Z',
    ruleId: 'content:broken-image',
    category: 'content',
    source: 'deterministic',
    severity: 'high',
    url: 'https://www.ryzesuperfoods.com/products/x',
    title: 'Broken hero image',
    description: 'The hero image failed to load (naturalWidth === 0).',
    confidence: 0.9,
    ...overrides,
  };
}

/** Fake client whose verdict depends on the requested model. Optionally throws
 *  for specific models to exercise the error path. */
function clientByModel(
  byModel: Record<string, unknown>,
  opts: { throwFor?: string[] } = {},
): { client: Anthropic; calls: () => number } {
  let n = 0;
  const client = {
    messages: {
      create: async ({ model }: { model: string }) => {
        n++;
        if (opts.throwFor?.includes(model)) throw new Error('boom:' + model);
        const input = byModel[model];
        if (input === undefined) throw new Error('no mock configured for model ' + model);
        return { content: [{ type: 'tool_use', name: 'submit_verdict', id: 'toolu', input }] };
      },
    },
  } as unknown as Anthropic;
  return { client, calls: () => n };
}

function tmpCrop(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-two-judge-'));
  const path = join(dir, 'crop.png');
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return { dir, path };
}

test('both judges confirmed → consensus confirmed, meanConfidence averages', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client, calls } = clientByModel({
      [SONNET]: { verdict: 'confirmed', confidence: 0.9, reasoning: 'broken' },
      [OPUS]: { verdict: 'confirmed', confidence: 0.8, reasoning: 'also broken' },
    });
    const res = await runTwoJudge({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.consensus).toBe('confirmed');
    expect(res.meanConfidence).toBeCloseTo(0.85, 5);
    expect(res.verdicts[0].judgeModel).toBe(SONNET);
    expect(res.verdicts[1].judgeModel).toBe(OPUS);
    expect(calls()).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both judges refuted → consensus refuted', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client } = clientByModel({
      [SONNET]: { verdict: 'refuted', confidence: 0.7, reasoning: 'fine' },
      [OPUS]: { verdict: 'refuted', confidence: 0.9, reasoning: 'clearly fine' },
    });
    const res = await runTwoJudge({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.consensus).toBe('refuted');
    expect(res.meanConfidence).toBeCloseTo(0.8, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both judges uncertain → consensus uncertain', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client } = clientByModel({
      [SONNET]: { verdict: 'uncertain', confidence: 0.3, reasoning: 'cant tell' },
      [OPUS]: { verdict: 'uncertain', confidence: 0.4, reasoning: 'ambiguous' },
    });
    const res = await runTwoJudge({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.consensus).toBe('uncertain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('one confirmed + one refuted → consensus disagree', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client } = clientByModel({
      [SONNET]: { verdict: 'confirmed', confidence: 0.9, reasoning: 'broken' },
      [OPUS]: { verdict: 'refuted', confidence: 0.9, reasoning: 'fine' },
    });
    const res = await runTwoJudge({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.consensus).toBe('disagree');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('one confirmed + one uncertain → consensus confirmed (uncertain is non-vote)', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client } = clientByModel({
      [SONNET]: { verdict: 'confirmed', confidence: 0.8, reasoning: 'broken' },
      [OPUS]: { verdict: 'uncertain', confidence: 0.2, reasoning: 'cant tell' },
    });
    const res = await runTwoJudge({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.consensus).toBe('confirmed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('one refuted + one uncertain → consensus refuted (uncertain is non-vote)', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client } = clientByModel({
      [SONNET]: { verdict: 'uncertain', confidence: 0.2, reasoning: 'cant tell' },
      [OPUS]: { verdict: 'refuted', confidence: 0.85, reasoning: 'fine' },
    });
    const res = await runTwoJudge({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.consensus).toBe('refuted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('one judge errors out → consensus uncertain, does not crash', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client } = clientByModel(
      { [OPUS]: { verdict: 'uncertain', confidence: 0.3, reasoning: 'ambiguous' } },
      { throwFor: [SONNET] },
    );
    const res = await runTwoJudge({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.consensus).toBe('uncertain');
    // the erroring pass soft-fails to an uncertain verdict (confidence 0)
    expect(res.verdicts[0].verdict).toBe('uncertain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both judges error out → consensus uncertain', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client } = clientByModel({}, { throwFor: [SONNET, OPUS] });
    const res = await runTwoJudge({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.consensus).toBe('uncertain');
    expect(res.meanConfidence).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config.models overrides the default pair', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client } = clientByModel({
      'model-a': { verdict: 'confirmed', confidence: 0.9 },
      'model-b': { verdict: 'confirmed', confidence: 0.9 },
    });
    const res = await runTwoJudge(
      { finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 },
      { models: ['model-a', 'model-b'] },
    );
    expect(res.consensus).toBe('confirmed');
    expect(res.verdicts[0].judgeModel).toBe('model-a');
    expect(res.verdicts[1].judgeModel).toBe('model-b');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
