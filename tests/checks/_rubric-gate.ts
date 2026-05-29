import type { Page } from '@playwright/test';
import type { CropTarget } from '../../src/crops/types.js';
import { evaluateRubric, type Rubric, type RubricResult } from '../../src/rubrics/index.js';
import type { DualWriteContext } from './_emit.js';

/**
 * Rubric-driven checks (worktree I) run LLM evaluations during the Playwright
 * crawl. To keep `npm run audit-only` zero-cost and unsurprising, they are
 * OPT-IN: a rubric only fires when RYZE_ENABLE_RUBRICS=1 AND an Anthropic
 * credential is available (ANTHROPIC_API_KEY in production, or an injected
 * client in tests) AND a dual-write context with a runId + findings collector
 * is present. Default off → evaluateRubric is never called.
 */
/** Directory rubric crops are written to. Read at call time (not module load)
 *  so RYZE_RUBRIC_CROP_DIR is honoured by tests and per-run overrides. */
export function rubricCropDir(): string {
  return process.env.RYZE_RUBRIC_CROP_DIR ?? 'output/crops';
}

export function rubricsEnabled(ctx?: DualWriteContext): ctx is DualWriteContext & {
  findings: NonNullable<DualWriteContext['findings']>;
  runId: string;
} {
  return (
    process.env.RYZE_ENABLE_RUBRICS === '1' &&
    (!!process.env.ANTHROPIC_API_KEY || !!ctx?.rubricClient) &&
    !!ctx?.findings &&
    !!ctx?.runId
  );
}

/**
 * Run one rubric against an element and return the result. Plumbs the crop
 * directory and the (optional) injected client; soft-fails to null on any
 * unexpected error so a single rubric hiccup never aborts the audit.
 *
 * Callers MUST gate on {@link rubricsEnabled} before calling this.
 */
export async function runRubric(
  rubric: Rubric,
  page: Page,
  element: CropTarget,
  pageContext: Record<string, string | number | boolean | null>,
  ctx: DualWriteContext,
): Promise<RubricResult | null> {
  try {
    return await evaluateRubric(rubric, {
      element,
      pageContext,
      page,
      runId: ctx.runId!,
      cropOutputDir: rubricCropDir(),
      client: ctx.rubricClient,
    });
  } catch (err) {
    console.warn(`[rubric:${rubric.id}] evaluation error: ${(err as Error).message}`);
    return null;
  }
}
