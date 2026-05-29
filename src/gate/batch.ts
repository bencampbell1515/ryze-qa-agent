import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pLimit from 'p-limit';
import type { Finding, Severity, Source } from '../types/finding.js';
import type { GateConfig, GateResult } from './types.js';
import { evaluateGate, applyGateResult } from './run.js';

const DEFAULT_SEVERITY_FLOOR: Severity[] = ['critical', 'high'];
const DEFAULT_EXCLUDE_SOURCES: Source[] = ['rubric'];
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_SUPPRESSED_PATH = join(process.cwd(), 'data', 'suppressed-findings.jsonl');

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

/** Page-level context handed to the model alongside the crop. */
function pageContextFor(finding: Finding): Record<string, string | number | boolean | null> {
  const ctx: Record<string, string | number | boolean | null> = { url: finding.url };
  if (finding.viewport) ctx.viewport = finding.viewport;
  return ctx;
}

/**
 * Run the vision-confirmation gate over a collection of findings.
 *
 * In-scope findings (see {@link isEligible}) are evaluated in parallel up to
 * `concurrency`; out-of-scope findings pass through into `kept` untouched.
 * Suppressed findings (high-confidence `refuted`) are returned AND appended to
 * `suppressedPath` for reviewer auditability — runGateBatch is the sole writer
 * of that file. Insertion order of `kept` is preserved.
 */
export async function runGateBatch(
  findings: Finding[],
  config: GateConfig = {},
): Promise<{ kept: Finding[]; suppressed: Finding[] }> {
  const severityFloor = config.severityFloor ?? DEFAULT_SEVERITY_FLOOR;
  const excludeCategories = config.excludeCategories ?? [];
  const excludeSources = config.excludeSources ?? DEFAULT_EXCLUDE_SOURCES;
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const suppressedPath = config.suppressedPath ?? DEFAULT_SUPPRESSED_PATH;

  const limit = pLimit(concurrency);

  // Evaluate eligible findings in parallel. Each slot resolves to the kept
  // finding (visualGate populated) or null when suppressed; for suppressed
  // findings we also keep the GateResult so we can record WHY in the log.
  const resolved = await Promise.all(
    findings.map((finding) => {
      if (!isEligible(finding, severityFloor, excludeCategories, excludeSources)) {
        return Promise.resolve<{ kept: Finding | null; result: GateResult | null }>({ kept: finding, result: null });
      }
      return limit(async () => {
        const result = await evaluateGate({
          finding,
          cropPath: finding.crop?.path,
          pageContext: pageContextFor(finding),
          client: config.client,
          retryDelayMs: config.retryDelayMs,
        });
        return { kept: applyGateResult(finding, result, config.suppressThreshold), result };
      });
    }),
  );

  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  resolved.forEach(({ kept: keptFinding, result }, i) => {
    if (keptFinding === null) suppressed.push(stampSuppressionReason(findings[i]!, result));
    else kept.push(keptFinding);
  });

  if (suppressed.length > 0) {
    mkdirSync(dirname(suppressedPath), { recursive: true });
    for (const f of suppressed) {
      appendFileSync(suppressedPath, JSON.stringify(f) + '\n');
    }
  }

  return { kept, suppressed };
}
