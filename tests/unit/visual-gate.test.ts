import { test, expect } from '@playwright/test';
import { gateRecords } from '../../src/llm/visual-gate.js';
import type { BugRecord } from '../../src/types.js';

function fakeRecord(overrides: Partial<BugRecord> = {}): BugRecord {
  return {
    fingerprint: 'fp1',
    ruleId: 'content:broken-image',
    severity: 'high',
    bugClass: 'content',
    title: 'x',
    description: 'y',
    urls: ['https://example.com'],
    viewports: ['desktop'],
    instanceCount: 1,
    ...overrides,
  };
}

test('DISABLE_VISUAL_GATE=1 returns all records as kept with no gating', async () => {
  const prev = process.env.DISABLE_VISUAL_GATE;
  process.env.DISABLE_VISUAL_GATE = '1';
  try {
    const records = [fakeRecord(), fakeRecord({ fingerprint: 'fp2' })];
    const result = await gateRecords(records);
    expect(result.kept).toHaveLength(2);
    expect(result.suppressed).toHaveLength(0);
    expect(result.failedCount).toBe(0);
    expect(result.totalGated).toBe(0);
  } finally {
    if (prev === undefined) delete process.env.DISABLE_VISUAL_GATE;
    else process.env.DISABLE_VISUAL_GATE = prev;
  }
});

test('records with non-gated ruleIds pass through unchanged', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const records = [
      fakeRecord({ ruleId: 'revenue:cart-subtotal-missing' }),
      fakeRecord({ ruleId: 'seo:missing-canonical', fingerprint: 'fp2' }),
      fakeRecord({ ruleId: 'revenue:countdown-stuck', fingerprint: 'fp3' }),
    ];
    const result = await gateRecords(records);
    expect(result.kept).toHaveLength(3);
    expect(result.suppressed).toHaveLength(0);
    expect(result.totalGated).toBe(0);
    expect(result.kept.every((r) => r.verdict === undefined)).toBe(true);
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});

test('records with gated ruleIds are counted in totalGated', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const records = [
      fakeRecord({ ruleId: 'content:broken-image' }),
      fakeRecord({ ruleId: 'network:404', fingerprint: 'fp2' }),
      fakeRecord({ ruleId: 'revenue:cart-subtotal-missing', fingerprint: 'fp3' }),
    ];
    const result = await gateRecords(records);
    expect(result.totalGated).toBe(2);
    expect(result.kept).toHaveLength(3); // uncertain stays in kept
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});

import type Anthropic from '@anthropic-ai/sdk';

// Build a fake Anthropic client whose messages.create returns a tool_use block
// with the given verdict/reason. Tests inject this via the optional `client` param.
function fakeClient(verdict: 'visible' | 'uncertain' | 'not-visible', reason = 'mocked'): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [
          {
            type: 'tool_use',
            name: 'submit_verdict',
            id: 'toolu_test',
            input: { verdict, reason },
          },
        ],
        stop_reason: 'tool_use',
      }),
    },
  } as unknown as Anthropic;
}

test('verdict=visible → record kept with verdict set', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  try {
    const records = [fakeRecord({ ruleId: 'content:broken-image' })];
    const result = await gateRecords(records, { client: fakeClient('visible', 'hero is clearly broken') });
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].verdict).toBe('visible');
    expect(result.kept[0].verdictReason).toBe('hero is clearly broken');
    expect(result.suppressed).toHaveLength(0);
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});

test('verdict=not-visible → record routed to suppressed', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  try {
    const records = [fakeRecord({ ruleId: 'content:broken-image' })];
    const result = await gateRecords(records, { client: fakeClient('not-visible', 'far below the fold') });
    expect(result.kept).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].verdict).toBe('not-visible');
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});

test('verdict=uncertain → record stays in kept', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  try {
    const records = [fakeRecord({ ruleId: 'content:broken-image' })];
    const result = await gateRecords(records, { client: fakeClient('uncertain') });
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].verdict).toBe('uncertain');
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});

test('LLM error → failedCount++ and record kept as uncertain', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  let callCount = 0;
  const failThenSucceedClient = {
    messages: {
      create: async () => {
        callCount++;
        if (callCount <= 3) throw new Error('boom');
        return {
          content: [{ type: 'tool_use', name: 'submit_verdict', id: 'toolu_test', input: { verdict: 'visible', reason: 'ok' } }],
          stop_reason: 'tool_use',
        };
      },
    },
  } as unknown as Anthropic;
  try {
    const records = [
      fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'fail-fp' }),
      fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'pass-fp' }),
    ];
    const result = await gateRecords(records, { client: failThenSucceedClient, retryDelayMs: 1 });
    expect(result.failedCount).toBe(1);
    expect(result.kept).toHaveLength(2);
    const failedRec = result.kept.find((r) => r.fingerprint === 'fail-fp');
    expect(failedRec?.verdict).toBe('uncertain');
    expect(failedRec?.verdictReason).toBe('gate failed after retries');
    expect(result.suppressed).toHaveLength(0);
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});

function flakyClient(failureCount: number, finalVerdict: 'visible' | 'uncertain' | 'not-visible' = 'visible'): Anthropic {
  let calls = 0;
  return {
    messages: {
      create: async () => {
        calls++;
        if (calls <= failureCount) {
          const err = new Error('429 rate limited') as Error & { status?: number };
          err.status = 429;
          throw err;
        }
        return {
          content: [{ type: 'tool_use', name: 'submit_verdict', id: 'toolu_test', input: { verdict: finalVerdict, reason: 'ok' } }],
          stop_reason: 'tool_use',
        };
      },
    },
  } as unknown as Anthropic;
}

test('retry: 1 failure then success → record gated normally', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  try {
    const records = [fakeRecord({ ruleId: 'content:broken-image' })];
    const result = await gateRecords(records, { client: flakyClient(1, 'visible'), retryDelayMs: 1 });
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].verdict).toBe('visible');
    expect(result.failedCount).toBe(0);
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});

test('retry: 3 consecutive failures → record counted as failed, verdict=uncertain', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  // Use 2 records; flakyClient(99) fails fp1 every attempt (exhausts retries),
  // but succeeds fp2 on attempt 100 — however with 2 records: 1/2=50% ≤ 50%,
  // which is at the boundary (not > 50%), so no hard-fail throw.
  // To keep it simple: flakyClient(3) fails exactly maxAttempts (3) times then succeeds.
  // Record 1 gets calls 1-3 (all fail, exhausts retries), record 2 gets call 4 (succeeds).
  try {
    const records = [
      fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'fp-fail' }),
      fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'fp-pass' }),
    ];
    const result = await gateRecords(records, { client: flakyClient(3, 'visible'), retryDelayMs: 1 });
    expect(result.kept).toHaveLength(2);
    const failedRec = result.kept.find((r) => r.fingerprint === 'fp-fail');
    expect(failedRec?.verdict).toBe('uncertain');
    expect(result.failedCount).toBe(1);
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});

test('hard-fail: >50% of in-scope records fail → throws', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  try {
    const records = [
      fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'a' }),
      fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'b' }),
      fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'c' }),
    ];
    await expect(
      gateRecords(records, { client: flakyClient(99), retryDelayMs: 1 }),
    ).rejects.toThrow(/visual gate failed/i);
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});

test('hard-fail boundary: exactly 50% failed → does NOT throw', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  let calls = 0;
  const client = {
    messages: {
      create: async () => {
        calls++;
        if (calls <= 3) throw new Error('fail');
        return {
          content: [{ type: 'tool_use', name: 'submit_verdict', id: 't', input: { verdict: 'visible', reason: 'ok' } }],
          stop_reason: 'tool_use',
        };
      },
    },
  } as unknown as Anthropic;
  try {
    const records = [
      fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'a' }),
      fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'b' }),
    ];
    const result = await gateRecords(records, { client, retryDelayMs: 1 });
    expect(result.failedCount).toBe(1);
    expect(result.totalGated).toBe(2);
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});
