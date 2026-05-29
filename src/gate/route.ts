import type { Finding } from '../types/finding.js';
import type { TwoJudgeResult } from './two-judge.js';

export type Tier = 'main' | 'uncertain' | 'suppressed';

export interface RoutedFinding {
  finding: Finding;
  tier: Tier;
  twoJudge?: TwoJudgeResult;
}

/** Join the two judges' model names into the single `judgeModel` string field.
 *  The Finding contract types judgeModel as a string, so K records the pair as
 *  `modelA+modelB` (worktree-K assumption #2). */
function joinModels(tj: TwoJudgeResult): string {
  return `${tj.verdicts[0].judgeModel}+${tj.verdicts[1].judgeModel}`;
}

/** Merge both judges' one-line reasoning so a reviewer reading the uncertain
 *  tier can see why the two disagreed (or both hedged) without re-running. */
function joinReasons(tj: TwoJudgeResult): string {
  return tj.verdicts
    .map((v) => `[${v.judgeModel}] ${v.reasoning ?? ''}`.trim())
    .join(' | ');
}

/**
 * Apply a two-judge result to a finding and return its tier.
 *
 * Routing logic:
 *   consensus 'confirmed' (both judges agree)  → 'main'
 *   consensus 'refuted'   (both judges agree)  → 'suppressed'
 *   consensus 'uncertain' or 'disagree'         → 'uncertain'
 *
 * The finding's visualGate is updated (never mutated — a copy is returned):
 *   - main:      verdict='visible',  both judges' models + reasons recorded
 *   - uncertain: verdict='uncertain', both judges' models + reasons recorded,
 *                `uncertain` flag set so downstream tiers it correctly
 *   - suppressed: finding returned unchanged; the caller writes it to
 *                 suppressed-findings.jsonl (mirrors J's batch behaviour)
 */
export function routeFinding(finding: Finding, twoJudge: TwoJudgeResult): RoutedFinding {
  if (twoJudge.consensus === 'refuted') {
    return { finding, tier: 'suppressed', twoJudge };
  }

  const tier: Tier = twoJudge.consensus === 'confirmed' ? 'main' : 'uncertain';
  const routed: Finding = {
    ...finding,
    visualGate: {
      verdict: tier === 'main' ? 'visible' : 'uncertain',
      reason: joinReasons(twoJudge),
      judgeModel: joinModels(twoJudge),
    },
    ...(tier === 'uncertain' ? { uncertain: true } : {}),
  };
  return { finding: routed, tier, twoJudge };
}
