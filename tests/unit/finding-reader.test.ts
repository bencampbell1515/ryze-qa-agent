import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReportTiers } from '../../src/report/finding-reader.js';
import type { Finding, HygieneFinding } from '../../src/types/finding.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    fingerprint: 'fp-1',
    runId: 'r-1',
    discoveredAt: '2026-05-29T00:00:00.000Z',
    ruleId: 'content:broken-image',
    category: 'content',
    source: 'deterministic',
    severity: 'high',
    url: 'https://www.ryzesuperfoods.com/products/x',
    title: 'Broken image',
    description: 'A visible image renders empty.',
    confidence: 0.9,
    ...overrides,
  };
}

function makeHygiene(overrides: Partial<HygieneFinding> = {}): HygieneFinding {
  return {
    id: 'h-1',
    runId: 'r-1',
    discoveredAt: '2026-05-29T00:00:00.000Z',
    reason: 'deny-list-match',
    url: 'https://www.ryzesuperfoods.com/products/copy-of-thing',
    detail: { pattern: 'copy-of-*' },
    ...overrides,
  };
}

function writeJsonl(path: string, objs: unknown[]): void {
  writeFileSync(path, objs.map((o) => JSON.stringify(o)).join('\n') + '\n');
}

test('all four files present → correct tier counts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-reader-'));
  try {
    writeJsonl(join(dir, 'findings.jsonl'), [makeFinding({ id: 'm1' }), makeFinding({ id: 'm2' })]);
    writeJsonl(join(dir, 'uncertain-findings.jsonl'), [makeFinding({ id: 'u1', uncertain: true })]);
    writeJsonl(join(dir, 'suppressed-findings.jsonl'), [
      makeFinding({ id: 's1' }),
      makeFinding({ id: 's2' }),
      makeFinding({ id: 's3' }),
    ]);
    writeJsonl(join(dir, 'hygiene.jsonl'), [makeHygiene({ id: 'h1' }), makeHygiene({ id: 'h2' })]);

    const tiers = await readReportTiers(dir);

    expect(tiers.main.map((f) => f.id)).toEqual(['m1', 'm2']);
    expect(tiers.uncertain.map((f) => f.id)).toEqual(['u1']);
    expect(tiers.suppressed.map((f) => f.id)).toEqual(['s1', 's2', 's3']);
    expect(tiers.hygiene.map((h) => h.id)).toEqual(['h1', 'h2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only findings.jsonl present → main populated, others empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-reader-'));
  try {
    writeJsonl(join(dir, 'findings.jsonl'), [makeFinding({ id: 'm1' })]);

    const tiers = await readReportTiers(dir);

    expect(tiers.main.map((f) => f.id)).toEqual(['m1']);
    expect(tiers.uncertain).toEqual([]);
    expect(tiers.suppressed).toEqual([]);
    expect(tiers.hygiene).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed line in one file → skipped, others still read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-reader-'));
  try {
    // findings.jsonl has a garbage middle line plus two valid ones.
    writeFileSync(
      join(dir, 'findings.jsonl'),
      [JSON.stringify(makeFinding({ id: 'm1' })), '{ not valid json', JSON.stringify(makeFinding({ id: 'm2' }))].join('\n') + '\n',
    );
    writeJsonl(join(dir, 'hygiene.jsonl'), [makeHygiene({ id: 'h1' })]);

    const tiers = await readReportTiers(dir);

    expect(tiers.main.map((f) => f.id)).toEqual(['m1', 'm2']);
    expect(tiers.hygiene.map((h) => h.id)).toEqual(['h1']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data directory missing → all empty arrays, no error', async () => {
  const tiers = await readReportTiers(join(tmpdir(), 'ryze-reader-does-not-exist-xyz'));
  expect(tiers.main).toEqual([]);
  expect(tiers.uncertain).toEqual([]);
  expect(tiers.suppressed).toEqual([]);
  expect(tiers.hygiene).toEqual([]);
});

test('lines missing required fields are skipped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-reader-'));
  try {
    writeFileSync(
      join(dir, 'findings.jsonl'),
      [JSON.stringify({ id: 'no-rule-id' }), JSON.stringify(makeFinding({ id: 'm1' }))].join('\n') + '\n',
    );
    const tiers = await readReportTiers(dir);
    expect(tiers.main.map((f) => f.id)).toEqual(['m1']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
