import { test, expect } from '@playwright/test';
import { routeFinding } from '../../src/gate/route.js';
import type { TwoJudgeResult } from '../../src/gate/two-judge.js';
import type { GateResult } from '../../src/gate/types.js';
import type { Finding } from '../../src/types/finding.js';

const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';

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
    description: 'The hero image failed to load.',
    confidence: 0.9,
    ...overrides,
  };
}

function verdict(over: Partial<GateResult> = {}): GateResult {
  return { verdict: 'confirmed', confidence: 0.9, judgeModel: SONNET, ...over };
}

function twoJudge(over: Partial<TwoJudgeResult> = {}): TwoJudgeResult {
  return {
    verdicts: [verdict({ judgeModel: SONNET }), verdict({ judgeModel: OPUS })],
    consensus: 'confirmed',
    meanConfidence: 0.9,
    ...over,
  };
}

test('consensus confirmed → tier main, visualGate populated visible', () => {
  const tj = twoJudge({
    consensus: 'confirmed',
    verdicts: [
      verdict({ judgeModel: SONNET, verdict: 'confirmed', reasoning: 'broken' }),
      verdict({ judgeModel: OPUS, verdict: 'confirmed', reasoning: 'also broken' }),
    ],
  });
  const routed = routeFinding(makeFinding(), tj);
  expect(routed.tier).toBe('main');
  expect(routed.finding.visualGate!.verdict).toBe('visible');
  expect(routed.twoJudge).toBe(tj);
});

test('consensus refuted → tier suppressed', () => {
  const tj = twoJudge({ consensus: 'refuted' });
  const routed = routeFinding(makeFinding(), tj);
  expect(routed.tier).toBe('suppressed');
});

test('consensus uncertain → tier uncertain, visualGate uncertain', () => {
  const tj = twoJudge({ consensus: 'uncertain' });
  const routed = routeFinding(makeFinding(), tj);
  expect(routed.tier).toBe('uncertain');
  expect(routed.finding.visualGate!.verdict).toBe('uncertain');
  expect(routed.finding.uncertain).toBe(true);
});

test('consensus disagree → tier uncertain with both judges reasoning recorded', () => {
  const tj = twoJudge({
    consensus: 'disagree',
    verdicts: [
      verdict({ judgeModel: SONNET, verdict: 'confirmed', reasoning: 'looks broken to me' }),
      verdict({ judgeModel: OPUS, verdict: 'refuted', reasoning: 'renders fine' }),
    ],
  });
  const routed = routeFinding(makeFinding(), tj);
  expect(routed.tier).toBe('uncertain');
  expect(routed.finding.visualGate!.reason).toContain('looks broken to me');
  expect(routed.finding.visualGate!.reason).toContain('renders fine');
});

test('routed visualGate.judgeModel contains both model names joined with +', () => {
  const tj = twoJudge({
    consensus: 'confirmed',
    verdicts: [verdict({ judgeModel: SONNET }), verdict({ judgeModel: OPUS })],
  });
  const routed = routeFinding(makeFinding(), tj);
  expect(routed.finding.visualGate!.judgeModel).toBe(`${SONNET}+${OPUS}`);
});

test('routeFinding does not mutate the input finding', () => {
  const f = makeFinding();
  routeFinding(f, twoJudge({ consensus: 'confirmed' }));
  expect(f.visualGate).toBeUndefined();
  expect(f.uncertain).toBeUndefined();
});

test('suppressed tier leaves the finding without a visualGate (caller logs it)', () => {
  const routed = routeFinding(makeFinding(), twoJudge({ consensus: 'refuted' }));
  expect(routed.finding.visualGate).toBeUndefined();
});
