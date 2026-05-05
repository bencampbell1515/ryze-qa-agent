// tests/smoke/orchestrate.test.ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreBug, type ScoreContext } from '../../src/scoring/scorer.js';
import { deduplicateBugs } from '../../src/dedupe/fingerprint.js';
import type { BugInstance } from '../../src/types.js';

function loadFixtures(): BugInstance[] {
  const fixturePath = join(process.cwd(), 'tests/fixtures/smoke-bugs.jsonl');
  const lines = readFileSync(fixturePath, 'utf-8').trim().split('\n');
  return lines.map(line => JSON.parse(line) as BugInstance);
}

test('scorer produces revenue bug as top finding', () => {
  const bugs = loadFixtures();
  const ctx: ScoreContext = {
    knownFingerprints: new Set(),
    consensusCount: 1,
    confidence: 1.0,
  };

  const scored = bugs.map(bug => ({
    bug,
    score: scoreBug(bug, { ...ctx, confidence: bug.confidence ?? 1.0 }),
  }));

  const top = scored.reduce((a, b) => (a.score >= b.score ? a : b));
  expect(top.bug.bugClass).toBe('revenue');
});

test('deduplication does not collapse distinct 404s', () => {
  const bugs = loadFixtures();
  // bugs[1] and bugs[2] are the two 404 bugs — different URLs and messages
  const fourOhFourBugs = bugs.filter(b => b.ruleId === 'network:404');
  expect(fourOhFourBugs).toHaveLength(2);

  const result = deduplicateBugs(fourOhFourBugs);
  expect(result).toHaveLength(2);
});

test('scoring never produces negative scores', () => {
  const bugs = loadFixtures();
  // Worst-case context: confidence=0 maximises confidence_penalty to 1
  const worstCtx: ScoreContext = {
    knownFingerprints: new Set(),
    consensusCount: 1,
    confidence: 0,
  };

  for (const bug of bugs) {
    const score = scoreBug(bug, worstCtx);
    expect(score).toBeGreaterThanOrEqual(0);
  }
});
