import type { BugInstance } from '../../src/types.js';
import type { BugCollector } from '../fixtures/bug-collector.js';
import { buildFinding, type FindingCollector } from '../../src/findings/index.js';

/**
 * Dual-write context threaded into each migrated check. When present, every bug
 * a check emits also produces a canonical Finding. When absent (e.g. the
 * existing browser-driven unit tests that pass only `bugs`), checks behave
 * exactly as before — bug-stream only.
 */
export interface DualWriteContext {
  findings?: FindingCollector;
  runId?: string;
}

/**
 * Emit one finding to BOTH streams (worktree M dual-write, side-by-side).
 *
 * The BugInstance is passed to `bugs.add()` VERBATIM — the legacy bugs.jsonl
 * stream is byte-identical whether or not a Finding context is present. The
 * Finding is purely additive.
 *
 * Field derivation for the Finding:
 *   - category = the ruleId's `category:` prefix (canonical v2 source). When
 *     that prefix differs from the legacy bugClass (e.g. ruleId `security:*`
 *     with bugClass `content`), the original bugClass is preserved in
 *     meta.legacyBugClass so toBugInstance can round-trip it exactly.
 *   - description defaults to the bug's `message` when the caller doesn't pass
 *     a richer one.
 *   - selector / outerHTMLSnippet / pageScreenshot / elementScreenshot carry
 *     over from the BugInstance into the Finding's element/meta/crop fields.
 */
export function emitBug(
  bugs: BugCollector,
  ctx: DualWriteContext | undefined,
  bug: Omit<BugInstance, 'timestamp'>,
  finding: { title: string; description?: string },
): void {
  bugs.add(bug); // unchanged: legacy stream is the source of truth for bugs.jsonl

  if (ctx?.findings && ctx.runId) {
    const category = bug.ruleId.split(':')[0] || bug.bugClass;
    ctx.findings.add(
      buildFinding({
        runId: ctx.runId,
        url: bug.url,
        ruleId: bug.ruleId,
        category,
        severity: bug.severity,
        title: finding.title,
        description: finding.description ?? bug.message,
        selector: bug.selector,
        outerHtmlSnippet: bug.outerHTMLSnippet,
        pageScreenshotPath: bug.pageScreenshot,
        cropPath: bug.elementScreenshot,
        viewport: bug.viewport,
        legacyBugClass: category !== bug.bugClass ? bug.bugClass : undefined,
      }),
    );
  }
}
