# Worktree K: Two-Judge Routing for Uncertain Findings

## Mission

When J's vision-confirmation gate returns `uncertain` (low confidence,
or a borderline refute, or any other "I'm not sure" verdict), K runs a
second judge pass with a different model or prompt variant. Compare the
two verdicts. Agreement upgrades confidence. Disagreement routes the
finding to an "uncertain" tier separate from the main findings stream.

This is the calibration step. J catches the bulk of FPs that the gate
is confident about; K handles the edge cases where reasonable judges
can disagree. Reviewers see two streams: high-confidence findings (the
"main" tier they should triage) and uncertain findings (the "review
this if you have time" tier).

This is the smallest of the four sequential worktrees. The pattern is
already established by J — K is essentially "run J's gate twice with
different prompts and adjudicate."

## Why

The May 28 audit had a third FP category that neither rubrics (I) nor
the single-judge gate (J) fully solves: claims where the rendered state
is genuinely ambiguous. Examples from the audit:

- "Price formatting inconsistent": one viewport shows `$24.99`, another
  shows `24.99` (currency symbol off-screen due to layout). The check
  fires; the gate sees the cropped element and can't tell from one
  viewport's crop alone.
- "Image broken": a Shopify CDN image is slow but loading. The DOM
  reads as broken at check time; the crop captures a partial image
  that could be either still-loading or genuinely failed.
- "Search results missing": the search box returned zero hits, but the
  page rendered a "did you mean" suggestion that's arguably a valid
  empty-state, not a bug.

For these, a single judge says "uncertain" and J keeps the finding
with `visualGate.verdict = 'uncertain'`. Without K, those land in the
same findings.jsonl as confirmed findings and reviewers can't
distinguish them.

K's two-judge consensus gives a confidence signal:
- Both judges confirmed → high confidence, keep in main findings
- Both judges uncertain or one each → uncertain tier
- Both judges refuted → suppress (J would already have done this)

## Files to create

### `src/gate/two-judge.ts`

```typescript
import type { Finding } from '../types/finding.js';
import type { GateInput, GateResult } from './types.js';

export interface TwoJudgeConfig {
  /** Models to use for the two passes. Default ['claude-sonnet-4-6', 'claude-opus-4-7']. */
  models?: [string, string];
  /** Maximum concurrent judge pairs. Default 3. */
  concurrency?: number;
}

export interface TwoJudgeResult {
  /** Both judges' raw verdicts. */
  verdicts: [GateResult, GateResult];
  /** Consensus across the two judges. */
  consensus: 'confirmed' | 'refuted' | 'uncertain' | 'disagree';
  /** Mean confidence across the two judges. */
  meanConfidence: number;
}

/**
 * Run two judge passes on a finding and compute consensus.
 * Used by K to upgrade or downgrade J's uncertain verdicts.
 */
export async function runTwoJudge(
  input: GateInput,
  config?: TwoJudgeConfig
): Promise<TwoJudgeResult>;
```

Behavior:
1. Run `evaluateGate` from J twice in parallel, once with each model
   from `config.models`. The second pass uses the same crop and
   pageContext as the first (zero re-capture).
2. Consensus rules:
   - Both `confirmed` → `consensus: 'confirmed'`
   - Both `refuted` → `consensus: 'refuted'`
   - Both `uncertain` → `consensus: 'uncertain'`
   - One `confirmed` and one `refuted` → `consensus: 'disagree'`
   - One certain and one `uncertain` → use the certain one
     (the uncertain pass is treated as a non-vote)
3. `meanConfidence` is the average of the two `result.confidence` values.

### `src/gate/route.ts`

```typescript
import type { Finding } from '../types/finding.js';
import type { TwoJudgeResult } from './two-judge.js';

export type Tier = 'main' | 'uncertain' | 'suppressed';

export interface RoutedFinding {
  finding: Finding;
  tier: Tier;
  twoJudge?: TwoJudgeResult;
}

/**
 * Apply two-judge result to a finding and return its tier.
 *
 * Routing logic:
 *   consensus 'confirmed' (both judges agree) → 'main'
 *   consensus 'refuted'   (both judges agree) → 'suppressed'
 *   consensus 'uncertain' or 'disagree'        → 'uncertain'
 *
 * The finding's visualGate is updated:
 *   - main: verdict='visible' with both judges' models recorded
 *   - uncertain: verdict='uncertain', reasoning includes both judges
 *   - suppressed: caller writes to suppressed-findings.jsonl
 */
export function routeFinding(
  finding: Finding,
  twoJudge: TwoJudgeResult
): RoutedFinding;
```

### `src/gate/index.ts` (modify)

Add exports:
```typescript
export { runTwoJudge } from './two-judge.js';
export { routeFinding } from './route.js';
export type { TwoJudgeConfig, TwoJudgeResult } from './two-judge.js';
export type { Tier, RoutedFinding } from './route.js';
```

## Files to modify

### `src/gate/batch.ts`

Extend `runGateBatch` to invoke the two-judge pass when J's single
judge returns `uncertain`. Update the return shape to include the
uncertain tier:

```typescript
export async function runGateBatch(
  findings: Finding[],
  config?: GateConfig & { twoJudge?: TwoJudgeConfig; enableTwoJudge?: boolean }
): Promise<{
  kept: Finding[];           // tier === 'main'
  uncertain: Finding[];      // NEW tier
  suppressed: Finding[];     // tier === 'suppressed'
}>;
```

Behavior change inside `runGateBatch`:
1. For each finding, run J's single gate as today.
2. If J's verdict is `uncertain` AND `config.enableTwoJudge !== false`,
   run `runTwoJudge` on it.
3. Route via `routeFinding`.
4. Aggregate by tier.

Backward compat: if `enableTwoJudge` is omitted or `false`, behavior
is identical to J's. K is opt-in.

### `src/findings/collector.ts`

Wire the new tier into the flush hook. After `runGateBatch`:
- `kept` writes to `findings.jsonl` as before
- `uncertain` writes to a new `data/uncertain-findings.jsonl`
- `suppressed` writes to `data/suppressed-findings.jsonl` as J does

Gated by `RYZE_ENABLE_TWO_JUDGE=1` AND `RYZE_ENABLE_GATE=1` AND
`ANTHROPIC_API_KEY`. Same opt-in pattern.

### `tests/CLAUDE.md`

Add a section documenting the three-tier finding output (main /
uncertain / suppressed) and the env flags needed.

## Tests

### `tests/unit/two-judge.test.ts`

Mock the Claude API client (same as gate-run.test.ts).

- positive: both judges confirmed → consensus='confirmed', meanConf
  averages correctly
- positive: both judges refuted → consensus='refuted'
- positive: both judges uncertain → consensus='uncertain'
- positive: one confirmed + one refuted → consensus='disagree'
- positive: one confirmed + one uncertain → consensus='confirmed'
  (uncertain is non-vote)
- positive: one refuted + one uncertain → consensus='refuted'
- edge: one judge errors out → consensus='uncertain' (don't crash)
- edge: both judges error out → consensus='uncertain'

### `tests/unit/route.test.ts`

- positive: consensus='confirmed' → tier='main', visualGate populated
- positive: consensus='refuted' → tier='suppressed'
- positive: consensus='uncertain' → tier='uncertain'
- positive: consensus='disagree' → tier='uncertain' with both
  judges' reasoning recorded
- positive: the routed finding's visualGate.judgeModel contains
  both model names (joined or stored as array; document the choice)

### `tests/unit/gate-two-judge-integration.test.ts`

End-to-end with mock client:
- positive: runGateBatch with enableTwoJudge=true, mixed J verdicts
  → returns three tiers with correct counts
- positive: enableTwoJudge=false → identical to J's behavior
  (uncertain findings stay in the kept array)
- positive: uncertain-findings.jsonl is written when uncertain tier
  has entries

## Success criteria

- `npm run test:unit` passes (target ~1410, J landed at 1380, plus
  ~30 new K tests).
- `npx tsc --noEmit` clean.
- A dry-run against ryzesuperfoods.com with both env flags on:
  - At least one finding lands in each tier (or one tier is empty
    with a documented reason)
  - `data/uncertain-findings.jsonl` is created
  - Two-judge total LLM calls: 2× the single-judge count for findings
    that reach the two-judge pass
  - Cost estimate from the dry-run reported on the PR
- With `RYZE_ENABLE_TWO_JUDGE` unset (but `RYZE_ENABLE_GATE=1`): K is
  inactive, behavior identical to J.

## Boundaries — do not

- Modify J's gate logic. K extends; it doesn't change J.
- Modify rubric logic. K doesn't re-judge rubric findings (they
  already opt out via excludeSources from J).
- Modify FindingCollector's contract beyond adding the uncertain
  tier write.
- Add new severities, sources, or categories.
- Make K default-on. Opt-in only.
- Touch personas, scoring, dedupe, report.
- Add a third or fourth judge. K is two-judge by name and design;
  more judges is a future worktree decision.

## Reference

- `src/gate/run.ts` (J) — the single-judge gate K builds on
- `src/gate/batch.ts` (J) — the runner K extends
- `src/llm/retry.ts` (I) — the retry wrapper to reuse
- `src/findings/collector.ts` (M1) — the flush hook
- `docs/operational-constraints.md` — cost context

## PR convention

Title: `worktree-K: two-judge routing for uncertain findings`

Description must include:
- Files added (`src/gate/two-judge.ts`, `src/gate/route.ts`, tests)
- Files modified (`src/gate/batch.ts`, `src/findings/collector.ts`,
  `tests/CLAUDE.md`)
- Dry-run sample: 2-3 routed findings showing tier assignment and
  both judges' verdicts
- Cost estimate from dry-run: total LLM calls (single-judge + two-judge)
  and approximate dollar cost
- Confirmation that K opt-out (RYZE_ENABLE_TWO_JUDGE unset) preserves
  J's behavior
- Test count delta

## Open assumptions to verify

1. The model pair `['claude-sonnet-4-6', 'claude-opus-4-7']` — confirm
   both are available via the same Anthropic client. If `claude-opus-4-7`
   isn't accessible or is too expensive for routine use, fall back to
   running sonnet twice with different system prompts (prompt-variant
   ensemble instead of model-variant). Document either way.
2. Whether the `judgeModel` field on visualGate is a string or could
   become a string[]. Check `src/types/finding.ts`. If it's strictly
   a string, K joins the two model names with `+` (e.g.
   `claude-sonnet-4-6+claude-opus-4-7`).
3. Whether any consumer reads `findings.jsonl` and treats every entry
   as confirmed. With K, `findings.jsonl` contains only main-tier
   findings, and uncertain findings live in their own file. Should
   be invisible to current consumers (they don't read the new file),
   but verify.
4. The behavior when J is enabled but K is not on a previously-K-enabled
   run: any leftover `data/uncertain-findings.jsonl` from a prior run
   should not be re-read. Truncate at start of each run, same convention
   as bugs.jsonl handles its own input.
