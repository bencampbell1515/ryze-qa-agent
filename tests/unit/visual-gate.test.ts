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

test('with API key present, in-scope records get stub verdictReason', async () => {
  const prev = { dis: process.env.DISABLE_VISUAL_GATE, key: process.env.ANTHROPIC_API_KEY };
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'sk-test-fake';
  try {
    const records = [fakeRecord({ ruleId: 'content:broken-image' })];
    const result = await gateRecords(records);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].verdict).toBe('uncertain');
    expect(result.kept[0].verdictReason).toMatch(/not yet implemented/);
    expect(result.failedCount).toBe(0);
    expect(result.totalGated).toBe(1);
  } finally {
    if (prev.dis === undefined) delete process.env.DISABLE_VISUAL_GATE; else process.env.DISABLE_VISUAL_GATE = prev.dis;
    if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
  }
});
