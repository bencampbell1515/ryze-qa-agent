import { test, expect } from '@playwright/test';
import { buildSuppressedHtml } from '../../src/report/suppressed-builder.js';
import type { BugRecord } from '../../src/types.js';

function rec(overrides: Partial<BugRecord> = {}): BugRecord {
  return {
    fingerprint: 'fp1',
    ruleId: 'content:broken-image',
    severity: 'high',
    bugClass: 'content',
    title: 'Broken image',
    description: 'A broken hero image',
    urls: ['https://example.com/x'],
    viewports: ['desktop'],
    instanceCount: 3,
    verdict: 'not-visible',
    verdictReason: 'image is far below the fold; not part of any visible content area',
    ...overrides,
  };
}

test('buildSuppressedHtml: renders one card per record with verdict reason', async () => {
  const html = await buildSuppressedHtml([rec(), rec({ fingerprint: 'fp2', title: 'Another' })], { crawlDate: '2026-05-12' });
  expect(html).toContain('Suppressed');
  expect(html).toContain('Broken image');
  expect(html).toContain('Another');
  expect(html).toContain('far below the fold');
  expect(html).toContain('content:broken-image');
});

test('buildSuppressedHtml: empty input → renders empty-state message', async () => {
  const html = await buildSuppressedHtml([], { crawlDate: '2026-05-12' });
  expect(html.toLowerCase()).toContain('no suppressed');
});
