import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { evaluateGate, applyGateResult } from '../../src/gate/run.js';
import type { GateResult } from '../../src/gate/types.js';
import type { Finding } from '../../src/types/finding.js';

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

/** Fake Anthropic client whose messages.create returns a submit_verdict tool_use
 *  with the given input. Tracks call count for retry assertions. */
function fakeClient(input: unknown): { client: Anthropic; calls: () => number } {
  let n = 0;
  const client = {
    messages: {
      create: async () => {
        n++;
        return { content: [{ type: 'tool_use', name: 'submit_verdict', id: 'toolu_t', input }] };
      },
    },
  } as unknown as Anthropic;
  return { client, calls: () => n };
}

/** Fake client that always throws — for the API-error path. */
function throwingClient(): { client: Anthropic; calls: () => number } {
  let n = 0;
  const client = {
    messages: { create: async () => { n++; throw new Error('boom'); } },
  } as unknown as Anthropic;
  return { client, calls: () => n };
}

function tmpCrop(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-gate-'));
  const path = join(dir, 'crop.png');
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // bytes don't matter to the mock
  return { dir, path };
}

// ───────────────────────────── evaluateGate ────────────────────────────────

test('missing cropPath → uncertain, no LLM call', async () => {
  const { client, calls } = fakeClient({ verdict: 'refuted', confidence: 0.9 });
  const res = await evaluateGate({ finding: makeFinding(), client, retryDelayMs: 1 });
  expect(res.verdict).toBe('uncertain');
  expect(res.confidence).toBe(0);
  expect(res.reasoning).toBe('no crop available');
  expect(calls()).toBe(0);
});

test('crop path that does not exist → uncertain, no LLM call', async () => {
  const { client, calls } = fakeClient({ verdict: 'refuted', confidence: 0.9 });
  const res = await evaluateGate({ finding: makeFinding(), cropPath: '/nope/missing.png', client, retryDelayMs: 1 });
  expect(res.verdict).toBe('uncertain');
  expect(calls()).toBe(0);
});

test('confirmed verdict is returned from the model', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client } = fakeClient({ verdict: 'confirmed', confidence: 0.95, reasoning: 'image is broken' });
    const res = await evaluateGate({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.verdict).toBe('confirmed');
    expect(res.confidence).toBe(0.95);
    expect(res.reasoning).toBe('image is broken');
    expect(res.judgeModel).toBe('claude-sonnet-4-6');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('judgeModel override is honoured', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client } = fakeClient({ verdict: 'refuted', confidence: 0.9, reasoning: 'title is present' });
    const res = await evaluateGate({ finding: makeFinding(), cropPath: path, client, judgeModel: 'claude-haiku-4-5', retryDelayMs: 1 });
    expect(res.judgeModel).toBe('claude-haiku-4-5');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed tool-use response → retried, then uncertain', async () => {
  const { dir, path } = tmpCrop();
  try {
    // verdict is not a valid enum value → parse throws → withRetries exhausts.
    const { client, calls } = fakeClient({ verdict: 'definitely-broken', confidence: 0.9 });
    const res = await evaluateGate({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.verdict).toBe('uncertain');
    expect(calls()).toBe(3); // 3 attempts via withRetries
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API error → retries 3 times then uncertain', async () => {
  const { dir, path } = tmpCrop();
  try {
    const { client, calls } = throwingClient();
    const res = await evaluateGate({ finding: makeFinding(), cropPath: path, client, retryDelayMs: 1 });
    expect(res.verdict).toBe('uncertain');
    expect(res.reasoning).toBe('gate failed after retries');
    expect(calls()).toBe(3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ──────────────────────────── applyGateResult ──────────────────────────────

function result(overrides: Partial<GateResult> = {}): GateResult {
  return { verdict: 'confirmed', confidence: 0.9, judgeModel: 'claude-sonnet-4-6', ...overrides };
}

test('confirmed → finding kept with visualGate.verdict=visible', () => {
  const out = applyGateResult(makeFinding(), result({ verdict: 'confirmed', reasoning: 'clearly broken' }));
  expect(out).not.toBeNull();
  expect(out!.visualGate).toEqual({ verdict: 'visible', reason: 'clearly broken', judgeModel: 'claude-sonnet-4-6' });
});

test('refuted with confidence >= threshold → suppressed (null)', () => {
  const out = applyGateResult(makeFinding(), result({ verdict: 'refuted', confidence: 0.9, reasoning: 'title is right there' }));
  expect(out).toBeNull();
});

test('refuted with confidence < threshold → kept, marked uncertain', () => {
  const out = applyGateResult(makeFinding(), result({ verdict: 'refuted', confidence: 0.6, reasoning: 'maybe loading' }));
  expect(out).not.toBeNull();
  expect(out!.visualGate).toEqual({ verdict: 'uncertain', reason: 'maybe loading', judgeModel: 'claude-sonnet-4-6' });
});

test('uncertain → kept, marked uncertain', () => {
  const out = applyGateResult(makeFinding(), result({ verdict: 'uncertain', confidence: 0, reasoning: 'no crop available' }));
  expect(out).not.toBeNull();
  expect(out!.visualGate!.verdict).toBe('uncertain');
  expect(out!.visualGate!.reason).toBe('no crop available');
});

test('custom suppressThreshold respected: refuted 0.7 suppressed at threshold 0.6', () => {
  const out = applyGateResult(makeFinding(), result({ verdict: 'refuted', confidence: 0.7 }), 0.6);
  expect(out).toBeNull();
});

test('applyGateResult does not mutate the input finding', () => {
  const f = makeFinding();
  applyGateResult(f, result({ verdict: 'confirmed' }));
  expect(f.visualGate).toBeUndefined();
});
