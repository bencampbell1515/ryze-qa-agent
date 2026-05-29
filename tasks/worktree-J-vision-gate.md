# Worktree J: Vision-Confirmation Gate (Pre-Emit Validation)

## Mission

Add a vision-confirmation gate that validates deterministic findings
before they're written to `findings.jsonl`. The gate captures each
flagged element's crop (already exists via H + M's emitBug pattern),
sends it to Claude with the finding's claim, and gets back
`confirmed | refuted | uncertain`. Refuted findings are suppressed.
Uncertain findings are marked for K's two-judge routing. Confirmed
findings flow through with `visualGate.verdict = 'visible'`.

This is the second layer of accuracy improvement after I's rubrics.
Where I creates new findings from rendered state, J validates
existing findings from deterministic checks — catching the FPs that
don't have a rubric.

## Why

The May 28 audit had a consistent failure mode: deterministic checks
fire on edge cases the check's logic didn't anticipate. SEO check says
"missing title" on a page where the title loaded async. Image check
says "broken image" on a CDN that's slow but valid. Network check
flags a 304 as failure. Each is a small false-positive class that
doesn't justify its own rubric, but cumulatively they're the bulk of
the reviewer's complaints.

A single vision pass per critical-or-high finding catches all of these
generically: the model can see the rendered crop, read the claim, and
say "no, the title is right there" or "the image is loading, not
broken". For the 50-finding-ish audits this gets us toward, gating
costs ~$0.10-0.30 per audit (claude-sonnet-4-6, image-attached). Real
money, but cheap compared to a reviewer's hour spent dismissing FPs.

The v1 `src/llm/visual-gate.ts` checks visibility only ("is this
element visible?"). J asks a semantic question: "is this claim true?"

## Files to create

### `src/gate/types.ts`

```typescript
import type { Finding } from '../types/finding.js';

export type GateVerdict = 'confirmed' | 'refuted' | 'uncertain';

export interface GateResult {
  verdict: GateVerdict;
  confidence: number;
  /** One-line explanation from the model. Required for refuted/uncertain. */
  reasoning?: string;
  /** The Claude model that produced this verdict. */
  judgeModel: string;
}

export interface GateInput {
  finding: Finding;
  /** Path to the element crop. If undefined, gate returns uncertain (no visual context). */
  cropPath?: string;
  /** Page-level context for the model (URL, viewport, redirect info). */
  pageContext?: Record<string, string | number | boolean | null>;
  /** Model override for testing. */
  judgeModel?: string;
  /** Optional API client injection for testing. */
  client?: import('@anthropic-ai/sdk').default;
}

export interface GateConfig {
  /** Severities that get gated. Default ['critical', 'high']. */
  severityFloor?: Array<Finding['severity']>;
  /** Categories to skip gating (already covered by rubrics, etc.). */
  excludeCategories?: string[];
  /** Maximum concurrent gate calls. Default 5. */
  concurrency?: number;
}
```

### `src/gate/run.ts`

```typescript
import type { Finding } from '../types/finding.js';
import type { GateInput, GateResult } from './types.js';

/**
 * Evaluate a single finding's claim against its element crop.
 * Reuses the visual-gate API client pattern (forced tool-use,
 * withRetries from src/llm/retry.ts).
 */
export async function evaluateGate(input: GateInput): Promise<GateResult>;

/**
 * Apply gate verdicts to a finding. Returns the finding with
 * visualGate populated, or null if the verdict was 'refuted'
 * with confidence above the suppress threshold.
 */
export function applyGateResult(
  finding: Finding,
  result: GateResult,
  suppressThreshold: number = 0.8
): Finding | null;
```

Behavior of `evaluateGate`:
1. If `cropPath` is missing, return `{ verdict: 'uncertain',
   confidence: 0, reasoning: 'no crop available', judgeModel: '...' }`.
   The gate can't validate what it can't see.
2. Read the crop file as base64.
3. Build the prompt:
   - System: "You are validating a UI bug claim against a screenshot.
     Return only via the submit_verdict tool. Be conservative — only
     refute if the screenshot clearly contradicts the claim."
   - User: the finding's title and description, the page URL, the
     pageContext, the cropped image attached.
4. Use forced tool-use (same pattern as visual-gate.ts and the rubric
   runner from I): `tool_choice: { type: 'tool', name: 'submit_verdict' }`
   with a schema requiring verdict, confidence, optional reasoning.
5. Default model: `claude-sonnet-4-6`, overridable via `judgeModel`.
6. Wrap in `withRetries` from `src/llm/retry.ts` (extracted by I).
7. Return the structured result.

Behavior of `applyGateResult`:
1. Set `finding.visualGate` based on the verdict:
   - `confirmed` → `{ verdict: 'visible', reason: result.reasoning,
     judgeModel: result.judgeModel }`
   - `refuted` with confidence >= suppressThreshold → return null
     (suppress)
   - `refuted` with confidence < suppressThreshold → keep finding,
     set `visualGate.verdict: 'uncertain'`, populate reasoning
   - `uncertain` → keep finding, set `visualGate.verdict: 'uncertain'`,
     populate reasoning
2. Suppressed findings are not added to findings.jsonl. The runner
   logs them to a parallel `data/suppressed-findings.jsonl` for
   reviewer auditability (so suppressed FPs can be sanity-checked).

### `src/gate/batch.ts`

```typescript
import type { Finding } from '../types/finding.js';
import type { GateConfig } from './types.js';

/**
 * Run the gate over a collection of findings. Returns the kept set
 * (with visualGate populated) and the suppressed set (for the
 * parallel log file).
 */
export async function runGateBatch(
  findings: Finding[],
  config?: GateConfig
): Promise<{ kept: Finding[]; suppressed: Finding[] }>;
```

Behavior:
1. Filter findings by `severityFloor` (default critical + high) and
   `excludeCategories`. Findings outside the gate's scope pass through
   unchanged.
2. For each eligible finding, in parallel up to `concurrency`:
   - Call `evaluateGate` with the finding's crop and context
   - Apply the result via `applyGateResult`
3. Aggregate kept + suppressed.
4. Write suppressed findings to `data/suppressed-findings.jsonl`.

### `src/gate/index.ts`

Barrel export:
```typescript
export { evaluateGate, applyGateResult } from './run.js';
export { runGateBatch } from './batch.js';
export type { GateVerdict, GateResult, GateInput, GateConfig } from './types.js';
```

## Files to modify

### Wire the gate into the audit's emit path

The gate runs as a post-collection step before findings.jsonl is
written. The natural seam: `FindingCollector.flush()` (added by M1).
Before flush writes to disk, the collector runs the gate batch.

```typescript
// src/findings/collector.ts (the M1 module)

async flush(): Promise<void> {
  // existing flush logic...
  
  // NEW: Run vision-confirmation gate before disk write
  if (process.env.RYZE_ENABLE_GATE === '1' && process.env.ANTHROPIC_API_KEY) {
    const { kept, suppressed } = await runGateBatch(this.findings);
    this.findings = kept;
    await writeSuppressed(suppressed);
  }
  
  // existing disk write...
}
```

Two env requirements (mirroring I's pattern): `RYZE_ENABLE_GATE=1` AND
`ANTHROPIC_API_KEY`. Default off. `audit-only` stays zero-cost.

### Update `tests/CLAUDE.md`

Document the gate pattern alongside the dual-write and rubric patterns.

## Tests

### `tests/unit/gate-run.test.ts`

Mock the Claude API client (same pattern as visual-gate.test.ts and
rubrics-runner.test.ts).

- positive: confirmed verdict → applyGateResult returns finding with
  visualGate.verdict='visible'
- positive: refuted with confidence 0.9 → applyGateResult returns null
  (suppressed)
- positive: refuted with confidence 0.6 → applyGateResult returns
  finding with visualGate.verdict='uncertain'
- positive: uncertain → applyGateResult returns finding with
  visualGate.verdict='uncertain'
- edge: missing cropPath → evaluateGate returns uncertain without
  calling LLM
- edge: malformed tool-use response → withRetries kicks in; on
  persistent failure, returns uncertain
- edge: API error → retries up to 3 times, then uncertain

### `tests/unit/gate-batch.test.ts`

- positive: 5 findings, 3 in scope (severity high/critical), 2 out
  of scope (low/medium) → only 3 LLM calls, all 5 returned (2 unchanged)
- positive: all 3 in-scope findings confirmed → kept=5, suppressed=0
- positive: 1 refuted high-confidence → kept=4, suppressed=1
- positive: excludeCategories filter applies
- positive: concurrency limit respected (use a sleep-mock to verify
  parallelism caps at config.concurrency)
- positive: suppressed findings written to expected path

## Success criteria

- `npm run test:unit` passes (target ~1300, I landed at 1272, plus
  ~25 new gate tests).
- `npx tsc --noEmit` clean.
- A dry-run against ryzesuperfoods.com with `RYZE_ENABLE_GATE=1`:
  - Gate fires on every critical/high finding
  - At least one finding gets suppressed (validates the suppression
    path works end-to-end)
  - `data/suppressed-findings.jsonl` is created and parseable
  - Gate calls log per-finding cost via standard Anthropic response
    metadata (or at minimum, count the calls)
- With `RYZE_ENABLE_GATE` unset: no LLM calls, findings.jsonl
  identical to a pre-J run.

## Boundaries — do not

- Modify `src/llm/visual-gate.ts`. The v1 visibility gate stays
  exactly as it is.
- Modify `src/scoring/`, `src/dedupe/`, `src/report/`.
- Modify the persona system or rubric system from I.
- Add a new severity, source, or category.
- Change the v1 BugInstance path. J operates on Finding only.
- Touch the Finding interface itself in `src/types/finding.ts`. The
  `visualGate` field is already there; J populates it.
- Make the gate default-on. Opt-in only via the env flag.
- Run the gate during audit-only runs.

## Reference

- `src/llm/visual-gate.ts` for the API client pattern J reuses
- `src/llm/retry.ts` (extracted by I) for withRetries
- `src/rubrics/runner.ts` (from I) for the forced tool-use pattern
- `src/findings/collector.ts` (from M1) for the flush hook
- `src/types/finding.ts` for the VisualGate shape
- `docs/operational-constraints.md` for the gate's API budget context

## PR convention

Title: `worktree-J: vision-confirmation gate (pre-emit validation)`

Description must include:
- Files added (`src/gate/*`, tests)
- Files modified (FindingCollector flush hook, tests/CLAUDE.md)
- Dry-run sample: paste 2-3 gate verdicts (one confirmed, one
  refuted, one uncertain) showing the visualGate field populated
- Cost estimate: total LLM calls and approximate token cost from
  the dry-run
- Confirmation that audit-only (RYZE_ENABLE_GATE unset) produces
  identical findings.jsonl to pre-J
- Test count delta

## Open assumptions to verify

1. Where exactly `FindingCollector.flush()` lives and whether it's
   safe to add async batched LLM work there. Read the M1 module.
2. Whether the existing crops written by emitBug (H + M) are
   reachable by path from a finding's `crop.path` field. If
   `crop.path` is relative, the gate needs to resolve it.
3. Whether any v2 finding emitters write to findings.jsonl WITHOUT
   going through FindingCollector. If yes, the gate hook needs to
   move or be duplicated. The brief assumes one chokepoint.
4. The exact prompt for the gate. The brief specifies "be
   conservative — only refute if the screenshot clearly contradicts
   the claim." Test this against a few real findings during the
   dry-run; if the model over-refutes, raise the suppressThreshold
   or tighten the prompt. Document any prompt iteration on the PR.
