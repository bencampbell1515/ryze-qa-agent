# Worktree M: Migrate Page Checks from BugInstance to Finding (Dual-Write)

## Mission

Make the v1 page-level checks emit canonical `Finding` objects alongside
their existing `BugInstance` output, so that I/J/K (rubric checks, vision
gate, two-judge routing) can build on a real Finding stream from the
running pipeline. This worktree adds the second stream and migrates the
nine active page checks to populate it. It does NOT touch the existing
downstream (dedupe / score / report / visual-gate); that pipeline keeps
reading `BugInstance` and behaves identically after this lands. The
migration to a Finding-driven downstream happens in a later worktree.

This is the largest single piece of work in the rebuild. It modifies the
running audit pipeline rather than adding alongside it, so the risk
profile is different from worktrees A-G. The brief is structured to
preserve all current behavior by construction.

## Why

Worktree H gave us cropping (`src/crops/captureCrop`) but the v2 Finding
stream it was meant to populate doesn't exist yet at the page-check
layer. The current state on `main`:

- `tests/checks/*.ts` (revenue, seo, image, network, currency, search,
  newsletter, external-links, tap-targets, jsonld, opengraph, visual)
  emit `BugInstance` via `BugCollector.add()` → `data/bugs.jsonl`.
- `src/cross-page/*` (worktree B), `src/visual-regression/*` (F), and
  `tests/journeys/*` (E) emit `Finding[]` into nothing — no orchestrator
  wiring consumes them yet.
- Worktrees I (rubric checks), J (vision-confirmation gate), and K
  (two-judge routing) all assume a Finding stream exists at the page
  level. Without that, they have nothing to plug into.

This worktree closes the gap. After M, every check (v1 page-level and
v2 cross-page/visual/journey) emits canonical Findings into
`data/findings.jsonl`. The existing `data/bugs.jsonl` stream keeps
flowing unchanged so the existing audit report keeps rendering. Both
streams coexist during the transition.

## The dual-write contract

After M:

- **`data/bugs.jsonl`** — unchanged in shape and content. The existing
  pipeline (dedupe, score, report, visual-gate) keeps reading from it.
  Migrated checks must produce the same `BugInstance` they produce today.
  Regressions here will manifest as audit-report diffs and are the
  fastest way to know the migration broke something.
- **`data/findings.jsonl`** — new stream. One Finding per call site.
  Initially populated by the nine migrated checks plus a wiring step that
  collects the existing `Finding[]` outputs from cross-page / visual-
  regression / journeys. Future worktrees consume this.
- **Translation is one-way during M**: check call sites build a Finding
  first, then derive the BugInstance fields from it (a thin adapter).
  Going the other direction (BugInstance → Finding) is documented as
  lossy and is only used for the 3 disabled checks if we ever re-enable
  them.

## Files to create

### `src/findings/collector.ts`

```typescript
import type { Finding } from '../types/finding.js';

export interface FindingCollector {
  /** Append a finding to the in-memory list and the on-disk findings.jsonl. */
  add(finding: Finding): void;
  /** All findings collected in this run (for end-of-run consumers). */
  all(): Finding[];
  /** Flush any buffered writes. Called at the end of the audit. */
  flush(): Promise<void>;
}

export function createFindingCollector(
  outputPath?: string,
  runId?: string
): FindingCollector;
```

Behavior:
- Default `outputPath` is `data/findings.jsonl`, configurable for tests.
- Writes one JSON object per line. Append-only within a run.
- Captures the `runId` once and stamps each finding with it if not
  already set.
- Symmetric to `BugCollector` in design so it's familiar to anyone who's
  worked with the existing system.

### `src/findings/from-bug-instance.ts`

```typescript
import type { BugInstance } from '../types.js';
import type { Finding, ElementRef } from '../types/finding.js';

/**
 * Build a canonical Finding from the data a check has on hand at emit
 * time. Designed to be called from check sites in place of (or alongside)
 * BugCollector.add(bugInstance). The check supplies the typed inputs;
 * this function fills in fingerprint, id, runId stamping, etc.
 *
 * This is the FORWARD path: checks build Findings as the source of truth,
 * and the existing BugInstance is derived from them.
 */
export interface BuildFindingInput {
  runId: string;
  url: string;
  ruleId: string;          // "category:slug", e.g. "revenue:cart-subtotal-missing"
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  confidence?: number;     // defaults to 0.9 for deterministic checks
  element?: ElementRef;    // omit if no DOM element
  cropPath?: string;       // path written by captureBugCrop
  selector?: string;       // existing BugInstance field; goes into element.selector
  outerHtmlSnippet?: string; // existing BugInstance field; goes into meta
  pageScreenshotPath?: string; // existing pageScreenshot; goes into fullPageScreenshotPath
  viewport?: 'desktop' | 'tablet' | 'mobile';
  meta?: Record<string, string | number | boolean | null>;
}

export function buildFinding(input: BuildFindingInput): Finding;
```

Behavior:
- Generates `id` as `f-${runId}-${shortHash}` where `shortHash` is the
  first 8 chars of the fingerprint.
- Generates `fingerprint` per the check-author guide: 
  `sha1(ruleId + ":" + canonicalUrl + ":" + elementSignature)` where 
  `elementSignature` is `(role || "") + ":" + (name || "")` if an element
  is present, otherwise just the ruleId+url pair.
- Stamps `discoveredAt` with the current ISO timestamp.
- Sets `source: 'deterministic'` for all v1 page checks.
- Sets `visualGate: undefined` (let the gate run as it does today; for
  cropped findings the gate will mostly confirm visible).
- If `cropPath` provided, sets `crop` with width/height extracted from
  the file (use sharp for metadata; the crop already exists on disk so
  this is just a stat call).
- If `pageScreenshotPath` provided, sets `fullPageScreenshotPath`.

### `src/findings/to-bug-instance.ts`

```typescript
import type { BugInstance } from '../types.js';
import type { Finding } from '../types/finding.js';

/**
 * Derive the legacy BugInstance shape from a Finding. The migrated check
 * sites use this so they can produce both streams from a single source
 * of truth (the Finding) without duplicating logic.
 *
 * Field mapping:
 *   Finding.ruleId    → BugInstance.bugClass + check-specific subtype
 *   Finding.url       → BugInstance.url
 *   Finding.severity  → BugInstance.severity
 *   Finding.element.selector → BugInstance.selector
 *   Finding.meta.outerHtmlSnippet → BugInstance.outerHTMLSnippet
 *   Finding.crop?.path        → BugInstance.elementScreenshot
 *   Finding.fullPageScreenshotPath → BugInstance.pageScreenshot
 *   ...and so on
 *
 * Fields that don't map cleanly (rubricVerdicts, confidence > simple,
 * structured ElementRef beyond selector) are dropped. That's fine — the
 * legacy pipeline never used them.
 */
export function toBugInstance(finding: Finding): BugInstance;
```

The exact mapping needs to be derived by reading `src/types.ts`
(`BugInstance` shape) against `src/types/finding.ts` (`Finding` shape).
Document every field decision inline with a comment. If a field has no
mapping, document why and what's lost.

### `src/findings/index.ts`

Barrel export:
```typescript
export { createFindingCollector } from './collector.js';
export type { FindingCollector } from './collector.js';
export { buildFinding } from './from-bug-instance.js';
export type { BuildFindingInput } from './from-bug-instance.js';
export { toBugInstance } from './to-bug-instance.js';
```

### `tests/unit/findings-collector.test.ts`

- positive: `add()` then `all()` returns the added finding
- positive: `flush()` writes one JSON line per finding to the configured
  path; lines are parseable
- positive: runId is stamped on findings that don't carry one
- positive: runId is preserved on findings that already have one
- edge: empty collector flushes cleanly (creates empty file or no file
  depending on chosen convention — document either way)
- edge: collector writes are append-only within a run (calling flush
  twice doesn't truncate)

### `tests/unit/findings-translate.test.ts`

Two directions:

**`buildFinding`**:
- positive: minimal input (no element, no crop) produces a valid Finding
  with required fields populated
- positive: input with element + cropPath produces a Finding with
  populated `element` and `crop`
- positive: fingerprint is stable across two calls with the same input
- positive: fingerprint changes when the URL, ruleId, or element
  signature changes
- positive: id matches `f-${runId}-${shortHash}` pattern
- edge: empty meta produces no meta on the output (don't emit `meta: {}`)

**`toBugInstance`**:
- positive: a Finding with element + crop → BugInstance with
  selector + elementScreenshot populated
- positive: a Finding without element → BugInstance with no selector
- positive: severity, url, bugClass mapping verified
- edge: a Finding with rubricVerdicts → BugInstance ignores them
  (documented as expected behavior)

## Files to modify

### `src/types.ts`

Read the file. If `BugInstance` is already exported and stable, do NOT
modify it. The translation layer handles the impedance mismatch. The
goal is to leave the legacy type system untouched so downstream code
doesn't need to change.

If `BugInstance` is missing a field the migration needs (unlikely), add
it conservatively with a default and document. Surface on the PR.

### `tests/checks/*.ts` (the 9 active page checks)

The migration is the same pattern at every check site. Pseudocode of
what changes at each emit site:

```typescript
// Before:
bugs.add({
  url: page.url(),
  bugClass: 'revenue',
  severity: 'critical',
  selector: 'button[name=add]',
  // ...
  elementScreenshot: screenshotPath,
});

// After:
const finding = buildFinding({
  runId: ctx.runId,
  url: page.url(),
  ruleId: 'revenue:add-to-cart-missing',
  category: 'revenue',
  severity: 'critical',
  title: 'Add to cart button missing',
  description: '...',
  element: { selector: 'button[name=add]' },
  cropPath: screenshotPath, // captureBugCrop output from worktree H
  // ...
});
findings.add(finding);
bugs.add(toBugInstance(finding));
```

Both collectors are populated. The existing downstream sees the same
BugInstance it saw before; the new downstream sees the Finding.

Migrate these checks (verify list against actual repo):
- `tests/checks/revenue.ts`
- `tests/checks/seo.ts`
- `tests/checks/image.ts`
- `tests/checks/network.ts`
- `tests/checks/currency.ts`
- `tests/checks/search.ts`
- `tests/checks/newsletter.ts`
- `tests/checks/external-links.ts`
- `tests/checks/tap-targets.ts`
- `tests/checks/jsonld.ts`
- `tests/checks/opengraph.ts`
- `tests/checks/visual.ts`

That's 12 listed. The H session noted that `console.ts`, `a11y.ts`, and
`content.ts` are disabled. Confirm in CLAUDE.md and the crawl.spec.ts
manifest, then migrate the active ones only. Disabled checks: leave
alone, document why in the PR.

For each migration:
- Build the Finding first (call it the source of truth)
- Pass through `toBugInstance` to populate the existing BugInstance
  stream
- Verify the existing unit test for that check still passes unchanged
  (this is the key regression signal)
- Add ONE new assertion to the existing unit test that checks the
  Finding stream got an entry with the expected ruleId

### `tests/checks/CLAUDE.md` (if it exists)

Document the dual-write pattern and the migration so future check
authors know to do both.

### Orchestrate / run-audit wiring

The run-audit script needs to instantiate a FindingCollector alongside
the existing BugCollector and pass both to the checks. Look at
`scripts/run-audit.ts` and `scripts/orchestrate.ts` for the existing
BugCollector instantiation pattern and mirror it for findings.

Also wire the existing v2 emitters into the same FindingCollector:
- `src/cross-page/*` (B's checks) — currently their `Finding[]` outputs
  flow into nothing; route them to the FindingCollector
- `src/visual-regression/*` (F) — same
- `tests/journeys/*` (E) — these already write to a `data/journey-
  findings.jsonl` per E's brief; either consolidate into `findings.jsonl`
  or document why they stay separate (probably consolidate)

This is the one place M touches orchestrate. Touch it minimally: add a
FindingCollector instantiation, pass it where needed, flush at end of
run. Do NOT refactor orchestrate's pipeline order. Do NOT change how
the existing audit ends or reports.

## Boundaries — do not

- Modify `src/scoring/*` — the scorer still reads BugInstance
- Modify `src/dedupe/*` — dedupe still operates on BugInstance
- Modify `src/report/*` — the report still renders from BugInstance/
  ScoredBug. Yes, this means the new Finding stream isn't visible in
  the audit report yet. That's by design; the report migration is a
  later worktree.
- Modify `src/llm/visual-gate.ts` — the gate keeps gating BugInstance
- Remove the `data/bugs.jsonl` write path — it stays as the legacy
  stream throughout this worktree
- Modify the disabled checks (`a11y.ts`, `console.ts`, `content.ts`)
- Modify `src/types/finding.ts` — the v2 Finding contract is frozen
- Modify `src/types.ts`'s `BugInstance` shape unless you find a true gap
- Migrate the cross-page / visual-regression / journey modules to emit
  differently — they already emit Findings; this worktree just routes
  their output into the new collector
- Introduce a new severity, category, or source value
- Add LLM calls (M is pure plumbing; no model invocations)

## TDD discipline (lessons from worktree H)

- Write tests first. Watch them fail. Implement. Watch them pass.
- When a test fails, investigate the root cause before "fixing" the test.
  H caught a real DPI/emulation bug because the session refused to paper
  over a 1px discrepancy. Same discipline here.
- Pin Playwright project-leak settings on `newPage()` calls in tests:
  `deviceScaleFactor: 1, isMobile: false, hasTouch: false`. The mobile
  project leaks a 980×735 layout viewport into 800×600 screenshots if
  you don't.
- Real bugs in production code go in production code, not the tests.
  If a test reveals the production logic is wrong, fix the production
  logic.

## Success criteria

- `npm run test:unit` passes with at least 770 tests (H landed at 764;
  this worktree adds ~20 tests across the new modules and per-check
  assertions).
- `npx tsc --noEmit` clean.
- A dry-run audit produces both `data/bugs.jsonl` AND `data/findings.jsonl`.
  Every entry in bugs.jsonl has a corresponding entry in findings.jsonl
  with matching url + severity + (where applicable) element selector.
- The audit's HTML report renders identically to a pre-M run — same
  finding count, same severities, same screenshots. The Finding stream
  is purely additive; the report doesn't see it yet.
- The 9 migrated check unit tests pass unchanged plus the new
  per-check Finding-emission assertion.
- The cross-page / visual-regression / journey modules' Findings show
  up in `data/findings.jsonl` after a dry-run, alongside the v1 page
  check Findings.

## Reference

- `src/types.ts` — `BugInstance`, `BugRecord`, `ScoredBug` shapes
- `src/types/finding.ts` — `Finding`, `ElementRef`, `ElementCrop` shapes
- `src/dedupe/fingerprint.ts:113` — where BugInstance becomes BugRecord
  (this stays unchanged; just useful to understand the legacy pipeline)
- `src/report/screenshot-cropper.ts` — H's three-tier cropper that the
  report uses
- `docs/check-author-guide.md` — fingerprint formula, source values,
  severity floors
- `docs/operational-constraints.md` — Cloudflare/O2O context
- `tasks/worktree-H-element-cropping.md` — H's approach to migrating
  v1 capture sites without breaking downstream; M follows the same
  preservation philosophy
- PR #8 (worktree-H) — for the captureBugCrop pattern in the v1 checks

## PR convention

Title: `worktree-M: dual-write Finding stream alongside BugInstance`

Description must include:
- Files added (src/findings/*, tests added)
- Files modified (per-check migrations, run-audit wiring) — list every
  check by name with a one-liner on what changed
- Per-check verification: paste a snippet of the diff for one check as
  representative, then assert that the other 8 follow the same pattern
- Sample findings.jsonl entries (5-10 lines) from a dry-run
- Confirmation that bugs.jsonl is unchanged in shape: diff the first
  10 lines of bugs.jsonl from before this branch vs after, paste
- Test count delta
- Any check where the migration revealed a bug or non-obvious mapping
  decision; document each one

## Open assumptions to verify

1. **BugCollector's exact API.** The brief assumes `bugs.add(bugInstance)`.
   Confirm against `tests/fixtures/bug-collector.ts` and adjust the
   pattern if the actual signature differs.

2. **runId provenance.** The brief assumes a `runId` is available at
   each check site, presumably via a context object. Confirm by reading
   how existing checks receive context; the migration may need to add
   `runId` to the context shape.

3. **The 12-check active list.** Confirm by reading `crawl.spec.ts` (or
   wherever the check manifest lives) which checks actually fire. The
   H session said console/a11y/content are disabled; confirm and adjust
   the migration scope.

4. **Whether `data/findings.jsonl` already exists from cross-page or
   journey writes.** The B/E briefs mentioned writing to streams; check
   whether they wrote to a hygiene stream, findings.jsonl, or
   journey-findings.jsonl. If multiple streams exist, decide whether M
   consolidates into one `findings.jsonl` or maintains parallel files.
   Recommended: consolidate. But surface the decision on the PR.

5. **Whether checks are async or synchronous in their emit pattern.**
   `bugs.add()` is currently synchronous; `findings.add()` should match
   to avoid changing every call site's await semantics. The collector's
   `flush()` is async, called once at end of run.

6. **The `BugInstance.bugClass` enum.** The brief's `toBugInstance`
   mapping derives `bugClass` from `Finding.category`. Verify the
   enum values match (`a11y`, `console`, `network`, `visual`, `seo`,
   `revenue`, `content`, `lighthouse`) and decide what to do when a
   v2 category doesn't have a v1 bugClass equivalent (e.g.
   `cross-page`, `journey`). Probably fall back to `bugClass: 'content'`
   or add a new enum value. Document the decision.

## If you want to split this into two PRs

The brief treats M as a single PR. If during execution it feels too
large, the natural split is:

- **M.1**: Build the new `src/findings/*` infrastructure + migrate ONE
  check (recommend `revenue.ts` since it's the most-cited example in
  the rebuild). Ship as a complete dual-write proof.
- **M.2**: Mechanically migrate the remaining 8 checks following the
  M.1 pattern.

The session has discretion. If it splits, name them
`worktree-M1` and `worktree-M2` consistently.
