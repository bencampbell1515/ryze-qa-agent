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

test('DISABLE_VISUAL_GATE=1 short-circuits: all records kept, no SDK calls', async () => {
  process.env.DISABLE_VISUAL_GATE = '1';
  const records = [fakeRecord(), fakeRecord({ fingerprint: 'fp2' })];
  const result = await gateRecords(records);
  expect(result.kept).toHaveLength(2);
  expect(result.suppressed).toHaveLength(0);
  expect(result.failedCount).toBe(0);
  expect(result.totalGated).toBe(0);
  delete process.env.DISABLE_VISUAL_GATE;
});
