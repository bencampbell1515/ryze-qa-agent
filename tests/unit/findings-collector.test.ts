import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFindingCollector } from '../../src/findings/index.js';
import type { Finding } from '../../src/types/finding.js';

/** Minimal valid Finding for collector tests (collector is agnostic to content). */
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-test-deadbeef',
    fingerprint: 'deadbeef00000000',
    runId: '',
    discoveredAt: '2026-05-29T00:00:00.000Z',
    ruleId: 'revenue:no-price',
    category: 'revenue',
    source: 'deterministic',
    severity: 'critical',
    url: 'https://www.ryzesuperfoods.com/products/x',
    title: 'No price',
    description: 'No visible price found',
    confidence: 0.9,
    ...overrides,
  };
}

function tmpFindingsPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-findings-'));
  return { dir, path: join(dir, 'findings.jsonl') };
}

test('add() then all() returns the added finding', () => {
  const { dir, path } = tmpFindingsPath();
  try {
    const collector = createFindingCollector(path, 'run-1');
    const f = makeFinding({ runId: 'run-1' });
    collector.add(f);
    expect(collector.all()).toHaveLength(1);
    expect(collector.all()[0]!.ruleId).toBe('revenue:no-price');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flush() writes one parseable JSON line per finding', async () => {
  const { dir, path } = tmpFindingsPath();
  try {
    const collector = createFindingCollector(path, 'run-1');
    collector.add(makeFinding({ runId: 'run-1', id: 'f-1' }));
    collector.add(makeFinding({ runId: 'run-1', id: 'f-2' }));
    await collector.flush();

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l) as Finding);
    expect(parsed[0]!.id).toBe('f-1');
    expect(parsed[1]!.id).toBe('f-2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runId is stamped on findings that do not carry one', async () => {
  const { dir, path } = tmpFindingsPath();
  try {
    const collector = createFindingCollector(path, 'stamped-run');
    collector.add(makeFinding({ runId: '' }));
    expect(collector.all()[0]!.runId).toBe('stamped-run');
    await collector.flush();
    const parsed = JSON.parse(readFileSync(path, 'utf8').trim()) as Finding;
    expect(parsed.runId).toBe('stamped-run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runId is preserved on findings that already carry one', () => {
  const { dir, path } = tmpFindingsPath();
  try {
    const collector = createFindingCollector(path, 'collector-run');
    collector.add(makeFinding({ runId: 'finding-own-run' }));
    expect(collector.all()[0]!.runId).toBe('finding-own-run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('empty collector flushes cleanly without creating a file', async () => {
  const { dir, path } = tmpFindingsPath();
  try {
    const collector = createFindingCollector(path, 'run-1');
    await collector.flush();
    // Convention: nothing added → no file written (append-only, zero rows).
    expect(existsSync(path)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes are append-only within a run: flushing twice does not truncate or duplicate', async () => {
  const { dir, path } = tmpFindingsPath();
  try {
    const collector = createFindingCollector(path, 'run-1');
    collector.add(makeFinding({ runId: 'run-1', id: 'f-1' }));
    await collector.flush();
    collector.add(makeFinding({ runId: 'run-1', id: 'f-2' }));
    await collector.flush();
    // Second flush appends only the new finding; the first line is intact.
    await collector.flush(); // third flush: nothing new, must not duplicate

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]!) as Finding).id).toBe('f-1');
    expect((JSON.parse(lines[1]!) as Finding).id).toBe('f-2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('defaults to data/findings.jsonl when no outputPath is given', () => {
  // Construct with no path; we only assert it does not throw and exposes the API.
  const collector = createFindingCollector(undefined, 'run-1');
  expect(typeof collector.add).toBe('function');
  expect(typeof collector.all).toBe('function');
  expect(typeof collector.flush).toBe('function');
});
