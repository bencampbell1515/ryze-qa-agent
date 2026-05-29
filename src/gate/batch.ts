import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pLimit from 'p-limit';
import type { Finding, Severity, Source } from '../types/finding.js';
import type { GateConfig, GateResult } from './types.js';
import { evaluateGate, applyGateResult } from './run.js';
import { runTwoJudge, type TwoJudgeConfig, type TwoJudgeResult } from './two-judge.js';
import { routeFinding, type Tier } from './route.js';

const DEFAULT_SEVERITY_FLOOR: Severity[] = ['critical', 'high'];
const DEFAULT_EXCLUDE_SOURCES: Source[] = ['rubric'];
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_SUPPRESSED_PATH = join(process.cwd(), 'data', 'suppressed-findings.jsonl');
const DEFAULT_UNCERTAIN_PATH = join(process.cwd(), 'data', 'uncertain-findings.jsonl');

/** worktree-K: extends J's GateConfig with the two-judge knobs. Opt-in — when
 *  `enableTwoJudge` is omitted/false, runGateBatch behaves exactly like J. */
export type GateBatchConfig = GateConfig & {
  /** Run the two-judge pass on J-uncertain findings. Default off (J behaviour). */
  enableTwoJudge?: boolean;
  /** Two-judge model/concurrency config. Defaults applied in runTwoJudge. */
  twoJudge?: TwoJudgeConfig;
  /** Where uncertain-tier findings are logged. Default
   *  `data/uncertain-findings.jsonl`. runGateBatch is the sole writer. */
  uncertainPath?: string;
};

/**
 * Decide whether a finding is in the gate's scope.
 *
 * Out-of-scope findings pass through unchanged (no LLM call):
 * - severity below the floor (default keeps only critical + high),
 * - category in excludeCategories,
 * - source in excludeSources (default skips 'rubric' — already LLM-judged by I),
 * - a pre-populated visualGate (the type contract: "set to pre-confirm and skip
 *   the gate"; journey findings use this).
 */
function isEligible(
  finding: Finding,
  severityFloor: Severity[],
  excludeCategories: string[],
  excludeSources: Source[],
): boolean {
  if (finding.visualGate) return false;
  if (!severityFloor.includes(finding.severity)) return false;
  if (excludeCategories.includes(finding.category)) return false;
  if (excludeSources.includes(finding.source)) return false;
  return true;
}

/**
 * Stamp a suppressed finding with the gate's verdict/reason in `meta` so the
 * reviewer reading `suppressed-findings.jsonl` can see WHY it was killed without
 * re-running the gate. Returns a copy; never mutates the input.
 */
function stampSuppressionReason(finding: Finding, result: GateResult | null): Finding {
  if (!result) return finding;
  return {
    ...finding,
    meta: {
      ...(finding.meta ?? {}),
      gateVerdict: result.verdict,
      gateConfidence: result.confidence,
      ...(result.reasoning ? { gateReason: result.reasoning } : {}),
    },
  };
}

/** Two-judge analogue of {@link stampSuppressionReason}: records the consensus
 *  (both judges refuted) in `meta` for the suppressed-findings.jsonl reviewer. */
function stampTwoJudgeSuppression(finding: Finding, tj: TwoJudgeResult): Finding {
  return {
    ...finding,
    meta: {
      ...(finding.meta ?? {}),
      gateVerdict: 'refuted',
      gateConfidence: tj.meanConfidence,
      gateReason: tj.verdicts.map((v) => `[${v.judgeModel}] ${v.reasoning ?? ''}`.trim()).join(' | '),
    },
  };
}

/** Page-level context handed to the model alongside the crop. */
function pageContextFor(finding: Finding): Record<string, string | number | boolean | null> {
  const ctx: Record<string, string | number | boolean | null> = { url: finding.url };
  if (finding.viewport) ctx.viewport = finding.viewport;
  return ctx;
}

/** The tier a finding resolved to, plus the (possibly stamped) finding to emit. */
interface TierResult {
  tier: Tier;
  finding: Finding;
}

/**
 * Run the vision-confirmation gate over a collection of findings.
 *
 * In-scope findings (see {@link isEligible}) are evaluated in parallel up to
 * `concurrency`; out-of-scope findings pass through into `kept` untouched.
 *
 * **Single-judge (J, default):** suppressed findings (high-confidence `refuted`)
 * are returned AND appended to `suppressedPath`. Everything else lands in `kept`.
 * `uncertain` is always `[]` in this mode.
 *
 * **Two-judge (K, `enableTwoJudge: true`):** when J's single judge returns the
 * `uncertain` verdict, a second judge pass runs ({@link runTwoJudge}) and the
 * finding is routed ({@link routeFinding}) into one of three tiers:
 *   - consensus confirmed → `kept` (main)
 *   - consensus uncertain/disagree → `uncertain` (logged to `uncertainPath`)
 *   - consensus refuted → `suppressed` (logged to `suppressedPath`)
 * Findings J is already confident about (confirmed, or refuted) never reach the
 * second pass. runGateBatch is the sole writer of both sibling files. Insertion
 * order within each tier is preserved.
 */
export async function runGateBatch(
  findings: Finding[],
  config: GateBatchConfig = {},
): Promise<{ kept: Finding[]; uncertain: Finding[]; suppressed: Finding[] }> {
  const severityFloor = config.severityFloor ?? DEFAULT_SEVERITY_FLOOR;
  const excludeCategories = config.excludeCategories ?? [];
  const excludeSources = config.excludeSources ?? DEFAULT_EXCLUDE_SOURCES;
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const suppressedPath = config.suppressedPath ?? DEFAULT_SUPPRESSED_PATH;
  const uncertainPath = config.uncertainPath ?? DEFAULT_UNCERTAIN_PATH;
  const enableTwoJudge = config.enableTwoJudge === true;

  const limit = pLimit(concurrency);

  const resolved = await Promise.all(
    findings.map((finding): Promise<TierResult> => {
      if (!isEligible(finding, severityFloor, excludeCategories, excludeSources)) {
        return Promise.resolve<TierResult>({ tier: 'main', finding });
      }
      return limit(async (): Promise<TierResult> => {
        const gateInput = {
          finding,
          cropPath: finding.crop?.path,
          pageContext: pageContextFor(finding),
          client: config.client,
          retryDelayMs: config.retryDelayMs,
        };
        const result = await evaluateGate(gateInput);

        // K: only J-uncertain findings escalate to the second judge. Findings J
        // is confident about (confirmed/refuted) take J's path unchanged.
        if (enableTwoJudge && result.verdict === 'uncertain') {
          const tj = await runTwoJudge(gateInput, config.twoJudge);
          const routed = routeFinding(finding, tj);
          if (routed.tier === 'suppressed') {
            return { tier: 'suppressed', finding: stampTwoJudgeSuppression(finding, tj) };
          }
          return { tier: routed.tier, finding: routed.finding };
        }

        // J path: applyGateResult → null (suppress) or kept-with-visualGate.
        const kept = applyGateResult(finding, result, config.suppressThreshold);
        if (kept === null) {
          return { tier: 'suppressed', finding: stampSuppressionReason(finding, result) };
        }
        return { tier: 'main', finding: kept };
      });
    }),
  );

  const kept: Finding[] = [];
  const uncertain: Finding[] = [];
  const suppressed: Finding[] = [];
  for (const r of resolved) {
    if (r.tier === 'main') kept.push(r.finding);
    else if (r.tier === 'uncertain') uncertain.push(r.finding);
    else suppressed.push(r.finding);
  }

  appendJsonl(suppressedPath, suppressed);
  appendJsonl(uncertainPath, uncertain);

  return { kept, uncertain, suppressed };
}

/** Append findings as JSONL, creating the parent dir. No file when the tier is
 *  empty (preserves J's "no suppressed → file not created" contract). */
function appendJsonl(path: string, findings: Finding[]): void {
  if (findings.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  for (const f of findings) {
    appendFileSync(path, JSON.stringify(f) + '\n');
  }
}
