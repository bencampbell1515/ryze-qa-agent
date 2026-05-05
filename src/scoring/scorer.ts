// src/scoring/scorer.ts
import { createHash } from 'node:crypto';
import { normalizeMessage } from '../dedupe/fingerprint.js';
import type { BugInstance, BugClass } from '../types.js';

export interface ScoreContext {
  /** Fingerprints from the last 3 full-audit:v2 runs (data/report-history.jsonl) */
  knownFingerprints: Set<string>;
  /** Validation confidence 0-1; use 1.0 for raw Playwright findings */
  confidence: number;
  /** Number of independent sources that flagged this finding */
  consensusCount: number;
}

export function getImpactWeight(bugClass: BugClass): number {
  const weights: Record<BugClass, number> = {
    revenue: 4,
    a11y: 2,
    network: 2,
    visual: 1,
    seo: 1,
    content: 1,
    console: 0.5,
    lighthouse: 1,
  };
  return weights[bugClass] ?? 0.5;
}

export function getPageImportance(url: string): number {
  if (
    url.match(/^https?:\/\/[^/]+\/?$/) ||
    url.includes('/products/')
  ) return 3;
  if (url.includes('/collections/')) return 2;
  return 1;
}

function getBugFingerprint(bug: BugInstance): string {
  const normalized = normalizeMessage(bug.message, bug.ruleId);
  return createHash('sha1')
    .update(`${bug.ruleId}|${normalized}|${bug.url}`)
    .digest('hex');
}

export function scoreBug(bug: BugInstance, ctx: ScoreContext): number {
  const impactWeight = getImpactWeight(bug.bugClass);
  const pageImportance = getPageImportance(bug.url);
  const noveltyBonus = !ctx.knownFingerprints.has(getBugFingerprint(bug)) ? 1 : 0;
  const confidencePenalty = 1 - ctx.confidence;

  const base = impactWeight + pageImportance + noveltyBonus;
  const multiplied = ctx.consensusCount >= 2 ? base * 1.5 : base;
  return Math.max(0, multiplied - confidencePenalty);
}
