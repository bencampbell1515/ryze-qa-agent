# Worktree I: Rubric-Driven Checks (Expected-State Comparison)

## Mission

Build a rubric-driven check layer that replaces open-ended "find bugs"
LLM prompts with structured expected-state comparison. Each rubric
defines what a correctly-rendered element looks like, the runner captures
the element with a tight crop (using H's captureCrop), sends it to
Claude with the rubric, and gets back a structured verdict that maps
cleanly to a Finding's rubricVerdicts[] field.

Ship 3-4 rubrics targeting the highest-value false-positive classes
from the May 28 audit: countdown timer, cart subtotal, wrong-product
redirect. These prove the pattern and immediately kill the most
embarrassing FPs from the audit PDF.

This is the accuracy step-change worktree. The audit PDF that motivated
the rebuild had a reviewer complaint that the AI personas were
hallucinating bugs. Rubrics convert open-ended judgment (the highest-
variance LLM task) into bounded comparison (the lowest-variance one).

## Why

From the strategy doc:

> Asking "find bugs on this page" is open-ended judgment, the highest-
> variance LLM task. Asking "here is the rendered cart summary element
> and here is the expected state (subtotal present, currency in USD
> format $X.XX, quantity editable); list any discrepancies" is a
> comparison task with explicit pass/fail criteria.

The specific FPs this targets, with their rubric encodings:

| Audit FP | Rubric encodes |
|---|---|
| `discovery:countdown-timer-broken` (00:00:00 is by-design when sale ended) | "00:00:00 is VALID if no active offer references this timer; BUG only if the page still presents the offer as live while the timer is frozen at zero" |
| `revenue:cart-subtotal-missing` (subtotal IS present, deterministic check wrong) | "A line-item subtotal is visible in the cart summary, formatted as currency. If a currency-formatted value is visible, no bug." |
| `discovery:wrong-product-displayed` (Shopify redirect to fallback is by-design) | "If the page reached this URL via a 30x redirect, the displayed product is expected to differ from the URL handle. Bug only if no redirect occurred." |

Each rubric is essentially a small written spec the model evaluates
against the rendered state.

## Files to create

### `src/rubrics/types.ts`

```typescript
import type { ElementCrop, Finding, RubricVerdict } from '../types/finding.js';

export interface RubricDimension {
  /** Short ID, e.g. "currency-format-correct". */
  id: string;
  /** Plain-English description of what to check. */
  description: string;
  /** Optional: explicit pass criteria (what "good" looks like). */
  passCriteria?: string;
  /** Optional: explicit fail criteria (what triggers a bug). */
  failCriteria?: string;
}

export interface Rubric {
  /** Stable rubric ID, e.g. "cart-summary-v1". */
  id: string;
  /** Short label for reports. */
  label: string;
  /** What this rubric evaluates. One-paragraph context for the model. */
  context: string;
  /** Per-dimension rules. */
  dimensions: RubricDimension[];
  /** ruleId this rubric emits findings under, e.g. "rubric:cart-summary-discrepancy". */
  ruleId: string;
  /** Category and severity for findings. */
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface RubricInput {
  /** The element being evaluated (a Playwright locator or pre-resolved box). */
  element: import('../crops/types.js').CropTarget;
  /** Optional page context the rubric needs (e.g. URL, redirect chain). */
  pageContext?: Record<string, string | number | boolean | null>;
  /** The page (for crop capture). */
  page: import('@playwright/test').Page;
  /** Run ID for finding stamping. */
  runId: string;
  /** Where to write the crop file. */
  cropOutputDir: string;
  /** Optional model override for testing. */
  judgeModel?: string;
}

export interface RubricResult {
  /** The Finding to emit (or null if every dimension passed). */
  finding: Finding | null;
  /** All verdicts from the rubric pass, even passing ones (for debugging). */
  verdicts: RubricVerdict[];
  /** The crop path captured during evaluation, for cache reuse. */
  cropPath: string;
}
```

### `src/rubrics/runner.ts`

```typescript
import type { Rubric, RubricInput, RubricResult } from './types.js';

/**
 * Evaluate an element against a rubric. Captures a tight crop, sends the
 * crop + rubric to Claude with a structured-output prompt, parses the
 * response into a RubricVerdict per dimension, and emits a Finding if
 * any dimension failed.
 */
export async function evaluateRubric(
  rubric: Rubric,
  input: RubricInput
): Promise<RubricResult>;
```

Behavior:

1. Capture the element crop via `captureCrop` (from H). If the element
   isn't visible, return `{ finding: null, verdicts: [], cropPath: '' }`
   and let the caller decide whether absence is itself a bug (most
   rubrics won't run on missing elements).
2. Build the prompt:
   - System: "You are evaluating a UI element against a rubric. Return
     ONLY a JSON object matching the schema. Be strict about pass/fail."
   - User: the rubric's context, the dimensions as a numbered list with
     pass/fail criteria, the page context (URL, redirect chain, etc.),
     the cropped image attached.
3. Send to Claude. Use `claude-sonnet-4-5` for accuracy on this layer
   (it's the rubric judge; quality matters more than cost here).
4. Parse the structured output into per-dimension RubricVerdicts.
5. If any dimension has `verdict: 'fail'`, build a Finding with all
   verdicts in `rubricVerdicts[]`, severity from the rubric, the
   strongest discrepancy line as the description.
6. Set `source: 'rubric'`, `confidence` to the mean of failing-dimension
   confidences, `crop` populated from the captured file.
7. Return the result.

Prompt template:
```
You are evaluating a UI element against a rubric.

CONTEXT: {rubric.context}

PAGE CONTEXT:
{JSON of pageContext}

RUBRIC DIMENSIONS:
1. {dimension.id}: {dimension.description}
   Pass: {dimension.passCriteria}
   Fail: {dimension.failCriteria}
2. ...

Return ONLY a JSON object with this exact shape:
{
  "verdicts": [
    {
      "dimension": "<dimension.id>",
      "verdict": "pass" | "fail" | "uncertain",
      "confidence": <0.0 to 1.0>,
      "discrepancy": "<one-line text if fail, omit otherwise>"
    },
    ...
  ]
}
```

Use the existing Claude API client pattern from `src/llm/visual-gate.ts`
(visual-gate.ts already handles base64 image attachment, retries, and
the 50% failure threshold pattern). Adapt that for rubric evaluation
rather than reinvent.

### `src/rubrics/registry.ts`

```typescript
import type { Rubric } from './types.js';
import { countdownTimerRubric } from './countdown-timer.js';
import { cartSubtotalRubric } from './cart-subtotal.js';
import { wrongProductRubric } from './wrong-product.js';

export const RUBRICS: Record<string, Rubric> = {
  'countdown-timer': countdownTimerRubric,
  'cart-subtotal': cartSubtotalRubric,
  'wrong-product': wrongProductRubric,
};

export function getRubric(id: string): Rubric | undefined;
```

### `src/rubrics/countdown-timer.ts`

```typescript
import type { Rubric } from './types.js';

export const countdownTimerRubric: Rubric = {
  id: 'countdown-timer-v1',
  label: 'Countdown timer is working as intended',
  context: 'A countdown timer is displayed on the page. Sales/offers ' +
    'sometimes end and the timer correctly displays 00:00:00 when the ' +
    'offer is over. The bug is when the timer is frozen at 00:00:00 ' +
    'while the page still presents the offer as active.',
  ruleId: 'rubric:countdown-timer-broken',
  category: 'content',
  severity: 'medium',
  dimensions: [
    {
      id: 'timer-state-matches-offer-state',
      description: 'Whether the countdown\'s displayed state matches ' +
        'the offer\'s active/ended state on the page.',
      passCriteria: 'Either: timer shows a positive countdown AND the ' +
        'page presents an active offer; OR timer shows 00:00:00 AND the ' +
        'page does NOT present an active offer (no "Buy Now" CTA, no ' +
        '"Sale ends in" text, no urgency messaging).',
      failCriteria: 'Timer shows 00:00:00 while the page still presents ' +
        'the offer as active (urgency messaging, CTAs, "limited time" text).',
    },
  ],
};
```

### `src/rubrics/cart-subtotal.ts`

```typescript
export const cartSubtotalRubric: Rubric = {
  id: 'cart-subtotal-v1',
  label: 'Cart shows a line-item subtotal',
  context: 'The cart summary should display a subtotal in currency ' +
    'format ($X.XX or $X,XXX.XX). This rubric verifies the subtotal ' +
    'is visible regardless of selector quirks or theme variations.',
  ruleId: 'rubric:cart-subtotal-missing',
  category: 'revenue',
  severity: 'high',
  dimensions: [
    {
      id: 'subtotal-visible-as-currency',
      description: 'Whether a subtotal value is visible in the cart ' +
        'summary, formatted as currency.',
      passCriteria: 'A currency-formatted value (e.g. "$24.99", ' +
        '"$1,234.56") is visible somewhere in the cart summary area, ' +
        'reasonably associated with the order total.',
      failCriteria: 'No currency-formatted value is visible in the ' +
        'cart summary area.',
    },
  ],
};
```

### `src/rubrics/wrong-product.ts`

```typescript
export const wrongProductRubric: Rubric = {
  id: 'wrong-product-v1',
  label: 'Product displayed matches the URL or a legitimate redirect',
  context: 'When a shopper visits a product URL, they expect the ' +
    'displayed product to match. Shopify redirects unavailable products ' +
    'to a fallback page; that\'s by-design. The bug is when an ACTIVE ' +
    'product URL renders a different product without a redirect.',
  ruleId: 'rubric:wrong-product-displayed',
  category: 'revenue',
  severity: 'high',
  dimensions: [
    {
      id: 'product-matches-url-or-redirect-occurred',
      description: 'Whether the displayed product matches the requested ' +
        'URL handle, OR whether a redirect chain explains the mismatch.',
      passCriteria: 'Page context shows redirect chain ' +
        '(pageContext.redirected=true) — by-design Shopify behavior. ' +
        'OR the displayed product name matches the URL slug.',
      failCriteria: 'pageContext.redirected=false AND the displayed ' +
        'product name does not match the URL slug.',
    },
  ],
};
```

### `src/rubrics/index.ts`

Barrel export:
```typescript
export { evaluateRubric } from './runner.js';
export { RUBRICS, getRubric } from './registry.js';
export type { Rubric, RubricDimension, RubricInput, RubricResult } from './types.js';
```

## Files to modify

### Wire each rubric into its corresponding check site

This is where the rubric integrates with the existing pipeline. Each
rubric replaces or supplements the corresponding deterministic check.

**Pattern**: deterministic check captures the element, calls
`evaluateRubric(rubric, input)`. The rubric's verdict either:
- All pass → no finding emitted (deterministic FP suppressed)
- Any fail → Finding emitted with rubricVerdicts and rubric.ruleId
- Any uncertain → Finding emitted with `uncertain: true` flag

Migrate these emit sites. Each is in tests/checks/ (verify):

1. `tests/checks/revenue.ts` — the cart-subtotal-missing emit site.
   Wrap with rubric evaluation. If rubric passes (subtotal IS visible),
   suppress the bug.
2. The countdown-timer-broken finding currently comes from the persona
   discovery layer (`src/discovery/agent-loop.ts` + persona prompts).
   For I's scope, add a new deterministic-style emit point that runs
   the countdown rubric on any element matching common countdown
   selectors. If no selectors match, the rubric doesn't fire.
3. Similar for wrong-product-displayed.

Keep all existing emit logic intact; the rubric runs ALONGSIDE and can
suppress the existing finding. The pattern:

```typescript
// existing deterministic check fires...
const deterministicBug = { ruleId: 'revenue:cart-subtotal-missing', ... };

// ...but BEFORE emitting, check the rubric
const rubricResult = await evaluateRubric(cartSubtotalRubric, {
  element: { kind: 'locator', locator: cartSummaryLocator },
  pageContext: { url: page.url() },
  page,
  runId: ctx.runId,
  cropOutputDir: 'output/crops',
});

if (rubricResult.finding === null) {
  // rubric confirms no bug; suppress the deterministic emit
  return;
}

// rubric agrees there's a bug; emit BOTH (rubric finding carries richer evidence)
emitBug(bugs, ctx, deterministicBug, { title: '...' });
ctx?.findings?.add(rubricResult.finding);
```

For checks that don't currently have a corresponding rubric (jsonld,
opengraph, etc.), do nothing. I's scope is the three rubrics named above.

### `scripts/run-audit.ts` or wherever the audit runs

If rubric runner needs API key plumbing (it does — Claude calls), make
sure the env var path exists. It probably already does for the persona
layer; reuse the same `ANTHROPIC_API_KEY` env var.

## Tests

### `tests/unit/rubrics-runner.test.ts`

Mock the Claude API call (the same way visual-gate.test.ts mocks it).
- positive: rubric with all dimensions passing → returns finding null
- positive: rubric with one dimension failing → returns Finding with
  rubricVerdicts populated, ruleId set, severity from rubric
- positive: mixed pass/fail dimensions → Finding's discrepancy uses
  the strongest failing dimension
- edge: invisible element → returns null finding without calling LLM
- edge: malformed JSON response → throws with raw output in error
- edge: API failure → retries per visual-gate.ts pattern; on persistent
  failure, returns `{ finding: null, verdicts: [] }` with `uncertain:
  true` semantics documented

### `tests/unit/rubrics-countdown.test.ts`

- positive: countdown at 00:00:00 with no active offer messaging → pass
- positive: countdown at 12:34:56 with active offer → pass
- positive: countdown at 00:00:00 WITH "Sale ends in" still displayed → fail
- edge: rubric ID/schema validation (ruleId starts with "rubric:")

### `tests/unit/rubrics-cart-subtotal.test.ts`

- positive: cart with visible "$24.99" subtotal → pass
- positive: cart with no currency-formatted value visible → fail
- positive: cart with hidden subtotal (display:none) → fail

### `tests/unit/rubrics-wrong-product.test.ts`

- positive: requested handle matches displayed product → pass
- positive: pageContext.redirected=true, displayed product differs → pass
- positive: pageContext.redirected=false, displayed differs → fail

For each rubric test, use a fixture HTML setContent + a mocked Claude
response that mirrors what a real model would return for the scenario.

## Success criteria

- `npm run test:unit` passes (target ~1200, M2 landed at 1156, plus
  ~40 new tests from rubrics).
- `npx tsc --noEmit` clean.
- A dry-run against ryzesuperfoods.com:
  - The cart-subtotal rubric fires correctly: when the deterministic
    check would have falsely fired, the rubric suppresses it
  - At least one countdown-timer evaluation occurs (whether it fires
    or not depends on live state)
  - Findings emitted from rubrics carry `source: 'rubric'`,
    `rubricVerdicts[]` populated, `ruleId` starts with `rubric:`
- The Finding stream (`data/findings.jsonl`) now contains rubric
  findings alongside deterministic ones, all sharing the same shape.

## Boundaries — do not

- Modify the persona discovery system (`src/discovery/agent-loop.ts`,
  `persona-runner.ts`, `tools.ts`). Personas keep running; rubrics
  run alongside. Persona sunset is a later worktree.
- Modify `src/scoring/`, `src/dedupe/`, `src/report/`. Rubric findings
  flow through the existing Finding stream and the downstream consumes
  them when M's downstream-migration future worktree lands.
- Modify the legacy `BugInstance` pipeline. Rubric findings are v2-only.
- Add new severities, sources, or categories. `source: 'rubric'`
  already exists in the Finding type.
- Build rubrics for every check. Three is plenty for the proof. The
  pattern is reusable for future rubrics.
- Touch the v1 BugInstance path. Rubric findings emit ONLY into
  findings.jsonl.

## Reference

- `src/llm/visual-gate.ts` for the existing Claude API client pattern
  (base64 image attachment, retries, 50% failure threshold)
- `src/crops/captureCrop` (worktree H) for element-level crop capture
- `src/findings/buildFinding` and the M1 dual-write pattern
- `src/types/finding.ts` — `RubricVerdict` interface is already there
- `docs/check-author-guide.md` for fingerprint formula, source values
- The May 28 audit PDF for the specific FPs being targeted

## PR convention

Title: `worktree-I: rubric-driven checks (countdown, cart subtotal, wrong product)`

Description must include:
- Files added (`src/rubrics/*`, tests added)
- Files modified (the integration sites)
- A dry-run sample: paste 2-3 rubric findings showing the
  `rubricVerdicts[]` structure with real verdicts and confidences
- Whether any of the three target FPs were suppressed during the dry-run
- API cost note: rubric runs ~1 Claude call per evaluation; for a 50-URL
  dry-run with three rubrics, expect ~150 calls. Report the actual
  count from the dry-run.
- Test count delta

## Open assumptions to verify

1. Whether `src/llm/visual-gate.ts`'s patterns are reusable directly or
   need a small refactor to share the API client with the rubric runner.
   Confirm by reading visual-gate.ts; prefer reuse over duplication.
2. Whether the cart-subtotal emit site in tests/checks/revenue.ts has
   a `cartSummaryLocator` (or equivalent) already in scope. If not,
   the rubric needs the locator passed in; the integration may need to
   add a line that resolves the locator.
3. Whether the countdown/wrong-product integration sites exist at all
   in the v1 check layer or whether they only exist in the persona
   discovery output. If only personas, the rubrics for those become
   "standalone" rubric checks rather than gates on existing emits — fire
   on every page that has the right selector. Document the decision.
4. Whether redirect-chain detection exists anywhere in the pipeline
   today. Playwright `page.goto()` returns a response with redirect
   chain info; if no code captures it currently, the wrong-product
   rubric needs a small addition to surface it as pageContext.
