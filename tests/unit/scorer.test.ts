// tests/unit/scorer.test.ts
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { scoreBug, getImpactWeight, getPageImportance } from '../../src/scoring/scorer.js';
import { normalizeMessage } from '../../src/dedupe/fingerprint.js';
import type { BugInstance } from '../../src/types.js';

function testFingerprint(bug: BugInstance): string {
  const normalized = normalizeMessage(bug.message, bug.ruleId);
  return createHash('sha1').update(`${bug.ruleId}|${normalized}|${bug.url}`).digest('hex');
}

const revenueBug: BugInstance = {
  ruleId: 'revenue:no-atc',
  severity: 'critical',
  bugClass: 'revenue',
  message: 'Add to Cart button not found',
  url: 'https://www.ryzesuperfoods.com/products/ryze-mushroom-coffee',
  viewport: 'desktop',
  timestamp: new Date().toISOString(),
};

const blogUiBug: BugInstance = {
  ruleId: 'a11y:color-contrast',
  severity: 'low',
  bugClass: 'a11y',
  message: 'Low contrast text',
  url: 'https://www.ryzesuperfoods.com/blogs/news/some-post',
  viewport: 'mobile',
  timestamp: new Date().toISOString(),
};

test('revenue bug on PDP scores 7 (known fingerprint in history, no consensus, full confidence)', () => {
  const score = scoreBug(revenueBug, {
    knownFingerprints: new Set([testFingerprint(revenueBug)]), // actual fingerprint in history
    confidence: 1.0,
    consensusCount: 1,
  });
  // impact(4) + page(3) + novelty(0, fingerprint is known) - penalty(0) = 7
  expect(score).toBeCloseTo(7, 1);
});

test('novelty bonus adds 1 when fingerprint is new', () => {
  const withNovelty = scoreBug(revenueBug, {
    knownFingerprints: new Set(),
    confidence: 1.0,
    consensusCount: 1,
  });
  expect(withNovelty).toBeCloseTo(8, 1);
});

test('novelty bonus fires when fingerprint absent from non-empty history set', () => {
  const score = scoreBug(revenueBug, {
    knownFingerprints: new Set(['some-other-sha1-abc123', 'another-fingerprint-xyz789']),
    confidence: 1.0,
    consensusCount: 1,
  });
  // impact(4) + page(3) + novelty(1, this fingerprint is not in set) - penalty(0) = 8
  expect(score).toBeCloseTo(8, 1);
});

test('consensus multiplier raises score by 1.5x', () => {
  const base = scoreBug(revenueBug, {
    knownFingerprints: new Set(['x']),
    confidence: 1.0,
    consensusCount: 1,
  });
  const consensus = scoreBug(revenueBug, {
    knownFingerprints: new Set(['x']),
    confidence: 1.0,
    consensusCount: 2,
  });
  expect(consensus).toBeCloseTo(base * 1.5, 1);
});

test('confidence penalty subtracts from score', () => {
  const full = scoreBug(revenueBug, {
    knownFingerprints: new Set(['x']),
    confidence: 1.0,
    consensusCount: 1,
  });
  const low = scoreBug(revenueBug, {
    knownFingerprints: new Set(['x']),
    confidence: 0.6,
    consensusCount: 1,
  });
  expect(low).toBeCloseTo(full - 0.4, 1);
});

test('blog UI bug scores lower than revenue PDP bug', () => {
  const ctx = { knownFingerprints: new Set<string>(), confidence: 1.0, consensusCount: 1 };
  const revenueScore = scoreBug(revenueBug, ctx);
  const uiScore = scoreBug(blogUiBug, ctx);
  expect(revenueScore).toBeGreaterThan(uiScore);
});

test('getImpactWeight returns correct weights', () => {
  expect(getImpactWeight('revenue')).toBe(4);
  expect(getImpactWeight('a11y')).toBe(2);
  expect(getImpactWeight('network')).toBe(2);
  expect(getImpactWeight('visual')).toBe(1);
  expect(getImpactWeight('seo')).toBe(1);
  expect(getImpactWeight('content')).toBe(1);
  expect(getImpactWeight('console')).toBe(0.5);
  expect(getImpactWeight('lighthouse')).toBe(1);
});

test('getPageImportance returns correct values', () => {
  expect(getPageImportance('https://www.ryzesuperfoods.com/')).toBe(3);
  expect(getPageImportance('https://www.ryzesuperfoods.com/products/coffee')).toBe(3);
  expect(getPageImportance('https://www.ryzesuperfoods.com/collections/all')).toBe(2);
  expect(getPageImportance('https://www.ryzesuperfoods.com/blogs/news/post')).toBe(1);
  expect(getPageImportance('https://www.ryzesuperfoods.com/pages/about')).toBe(1);
});

test('score is never negative even with very low confidence', () => {
  const score = scoreBug(blogUiBug, {
    knownFingerprints: new Set(['x']),
    confidence: 0.0,
    consensusCount: 1,
  });
  expect(score).toBeGreaterThanOrEqual(0);
});
