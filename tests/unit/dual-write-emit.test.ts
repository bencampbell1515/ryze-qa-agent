import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitBug } from '../checks/_emit.js';
import { createFindingCollector } from '../../src/findings/index.js';
import type { BugInstance } from '../../src/types.js';

/** Duck-typed stand-in for BugCollector (same shape currency.test.ts uses). */
function fakeBugs() {
  const collected: Array<Omit<BugInstance, 'timestamp'>> = [];
  return { collected, add: (b: Omit<BugInstance, 'timestamp'>) => collected.push(b) };
}

const sampleBug: Omit<BugInstance, 'timestamp'> = {
  ruleId: 'revenue:no-price',
  severity: 'critical',
  bugClass: 'revenue',
  message: 'No visible price found on https://www.ryzesuperfoods.com/products/x',
  url: 'https://www.ryzesuperfoods.com/products/x',
  viewport: 'desktop',
};

test('emitBug: always writes the BugInstance verbatim to the bug collector', () => {
  const bugs = fakeBugs();
  emitBug(bugs as any, undefined, sampleBug, { title: 'No price' });
  expect(bugs.collected).toHaveLength(1);
  expect(bugs.collected[0]).toBe(sampleBug); // same object reference — no mutation
});

test('emitBug: no Finding emitted when no dual-write context is given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-emit-'));
  try {
    const findings = createFindingCollector(join(dir, 'f.jsonl'), 'run-1');
    const bugs = fakeBugs();
    emitBug(bugs as any, undefined, sampleBug, { title: 'No price' });
    expect(findings.all()).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('emitBug: emits a matching Finding when a dual-write context is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-emit-'));
  try {
    const findings = createFindingCollector(join(dir, 'f.jsonl'), 'run-1');
    const bugs = fakeBugs();
    emitBug(bugs as any, { findings, runId: 'run-1' }, sampleBug, {
      title: 'No price',
      description: 'No visible price on the PDP.',
    });

    expect(bugs.collected).toHaveLength(1); // bug stream unchanged
    const all = findings.all();
    expect(all).toHaveLength(1);
    const f = all[0]!;
    expect(f.ruleId).toBe('revenue:no-price');
    expect(f.severity).toBe('critical');
    expect(f.url).toBe(sampleBug.url);
    expect(f.category).toBe('revenue'); // from ruleId prefix
    expect(f.source).toBe('deterministic');
    expect(f.title).toBe('No price');
    expect(f.description).toBe('No visible price on the PDP.');
    expect(f.runId).toBe('run-1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('emitBug: description defaults to the bug message when not supplied', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-emit-'));
  try {
    const findings = createFindingCollector(join(dir, 'f.jsonl'), 'run-1');
    const bugs = fakeBugs();
    emitBug(bugs as any, { findings, runId: 'run-1' }, sampleBug, { title: 'No price' });
    expect(findings.all()[0]!.description).toBe(sampleBug.message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('emitBug: preserves original bugClass in legacyBugClass when it differs from the ruleId category', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-emit-'));
  try {
    const findings = createFindingCollector(join(dir, 'f.jsonl'), 'run-1');
    const bugs = fakeBugs();
    // external-links style: ruleId category 'security', but bugClass 'content'.
    const secBug: Omit<BugInstance, 'timestamp'> = {
      ruleId: 'security:link-noopener-missing',
      severity: 'low',
      bugClass: 'content',
      message: 'target=_blank without rel=noopener',
      url: 'https://www.ryzesuperfoods.com/',
      viewport: 'desktop',
    };
    emitBug(bugs as any, { findings, runId: 'run-1' }, secBug, { title: 'Missing rel=noopener' });
    const f = findings.all()[0]!;
    expect(f.category).toBe('security');
    expect(f.meta?.legacyBugClass).toBe('content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
