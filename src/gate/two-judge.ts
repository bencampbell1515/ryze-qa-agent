import type { GateInput, GateResult } from './types.js';
import { evaluateGate } from './run.js';

/** Default judge pair: a Sonnet/Opus model-variant ensemble. The architectural
 *  diversity (two different model families) is the epistemic value of the second
 *  pass — see worktree-K brief. If `claude-opus-4-7` is unavailable at runtime,
 *  evaluateGate soft-fails that pass to `uncertain` (never throws), so K cleanly
 *  degrades to single-judge behaviour rather than crashing. */
export const DEFAULT_MODELS: [string, string] = ['claude-sonnet-4-6', 'claude-opus-4-7'];

export interface TwoJudgeConfig {
  /** Models to use for the two passes. Default ['claude-sonnet-4-6', 'claude-opus-4-7']. */
  models?: [string, string];
  /** Maximum concurrent judge pairs. Default 3. (Reserved for batch-level use;
   *  a single runTwoJudge call always runs its two passes in parallel.) */
  concurrency?: number;
}

export interface TwoJudgeResult {
  /** Both judges' raw verdicts, in the order of `config.models`. */
  verdicts: [GateResult, GateResult];
  /** Consensus across the two judges. */
  consensus: 'confirmed' | 'refuted' | 'uncertain' | 'disagree';
  /** Mean confidence across the two judges. */
  meanConfidence: number;
}

/**
 * Compute the two-judge consensus from a pair of verdicts.
 *
 * Rules (uncertain is a non-vote):
 * - both confirmed                  → 'confirmed'
 * - both refuted                    → 'refuted'
 * - both uncertain                  → 'uncertain'
 * - confirmed + refuted             → 'disagree'
 * - one certain + one uncertain     → the certain one ('confirmed' | 'refuted')
 */
function computeConsensus(a: GateResult, b: GateResult): TwoJudgeResult['consensus'] {
  const va = a.verdict;
  const vb = b.verdict;
  if (va === vb) {
    // both confirmed / both refuted / both uncertain
    return va;
  }
  if ((va === 'confirmed' && vb === 'refuted') || (va === 'refuted' && vb === 'confirmed')) {
    return 'disagree';
  }
  // exactly one is uncertain → the other (certain) verdict wins
  return va === 'uncertain' ? (vb as 'confirmed' | 'refuted') : (va as 'confirmed' | 'refuted');
}

/**
 * Run two judge passes on a finding and compute consensus.
 *
 * Both passes reuse the same crop and pageContext from `input` (zero re-capture);
 * only the `judgeModel` differs. The passes run in parallel and never throw — a
 * pass that rejects is treated as a synthetic `uncertain` (non-vote), so K can
 * route the finding rather than crash. Used by K to upgrade or downgrade J's
 * `uncertain` verdicts.
 */
export async function runTwoJudge(
  input: GateInput,
  config: TwoJudgeConfig = {},
): Promise<TwoJudgeResult> {
  const models = config.models ?? DEFAULT_MODELS;

  const settled = await Promise.allSettled(
    models.map((model) => evaluateGate({ ...input, judgeModel: model })),
  );

  const verdicts = settled.map((s, i): GateResult =>
    s.status === 'fulfilled'
      ? s.value
      : { verdict: 'uncertain', confidence: 0, reasoning: 'judge errored', judgeModel: models[i]! },
  ) as [GateResult, GateResult];

  return {
    verdicts,
    consensus: computeConsensus(verdicts[0], verdicts[1]),
    meanConfidence: (verdicts[0].confidence + verdicts[1].confidence) / 2,
  };
}
