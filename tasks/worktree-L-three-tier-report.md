# Worktree L: Web UI Updates (Three-Tier Report Display)

## Mission

Update the HTML audit report to display the rebuilt audit agent's
output: a main tier (high-confidence findings reviewers should triage),
an uncertain tier (findings that need a human look), and a hygiene
tier (the deny-list and Shopify-status exclusions that A's scope
filter produces). Swap every screenshot display from full-page hero
shots to the element crops produced by H. Show K's two-judge consensus
data when present.

This is the final worktree of the rebuild. After it lands, the report
reflects every accuracy improvement from A through K. The reviewer
opening the next audit report should immediately see the difference:
tight element crops where hero shots used to be, three clearly
separated tiers, confidence and judge data inline.

## Why

The May 28 audit's primary reviewer complaints were "can't tell what's
flagged" (solved by H's crops) and "too many false positives mixed
with real bugs" (solved by I/J/K's gating). The audit pipeline now
produces this differentiation, but the report doesn't surface it. L
makes the work visible.

## Files to modify

This worktree mostly modifies existing files rather than adding new
ones. The architecture for crops, tiers, and confidence is in place;
L is the rendering layer.

### `src/report/html-builder.ts`

The biggest change. Read the current file first to confirm structure;
the brief is reasoning about what should be there based on the M1/J
pipeline analysis.

Three sections in the rendered report, in order:

**1. Main findings.** The high-confidence findings reviewers should
triage. Sourced from `findings.jsonl` (K's "main" tier), or from the
existing BugRecord/ScoredBug stream while the v1→v2 downstream
migration is pending. The report currently shows these; the change is
the screenshot source (crops, not hero shots) and a small confidence
badge per finding.

**2. Uncertain tier.** Sourced from `data/uncertain-findings.jsonl`
(K's output). Same card layout as main but with a clear visual
distinction (a yellow border or "REVIEW" badge) and a collapsed-by-
default panel showing the two judges' reasoning. Reviewers can expand
to see "judge 1 said X, judge 2 said Y" and decide.

**3. Hygiene tier.** Sourced from `data/hygiene.jsonl` (A's scope-
filter output). NOT bugs — just a list of URLs the audit excluded
with the reason ("Shopify status: draft", "matched deny pattern
copy-of-*", etc.). Collapsed by default. Useful for reviewers who
want to confirm "nothing important was excluded."

### Crop display

Currently `screenshot-cropper.getCroppedScreenshot(bug)` returns a
three-tier fallback (element crop, top-350px slice, full page). H
already changed Tier 1 to prefer tight crops. L's change: ensure
findings carrying `crop.path` (from H + I's rubric paths) use that
path directly, bypassing the legacy `findFullPageShot` lookup
entirely. The legacy path remains as a fallback for findings without
crops.

If the report currently renders findings using BugRecord/ScoredBug
shapes (the M1 dual-write pattern means findings.jsonl has v2 Findings,
bugs.jsonl has v1 BugInstances and the report reads from the latter),
L adds a small switch: if a finding has a v2 Finding entry available
(matchable by ruleId + url), pull the crop from there. If not, fall
back to the legacy path.

### `src/report/screenshot-cropper.ts`

May need a small extension: a function that resolves a crop for a
Finding (vs the existing one for ScoredBug). Don't rewrite the
existing function; add a sibling.

### `src/report/styles.ts` (or wherever CSS lives)

Add styles for:
- `.tier-uncertain` (yellow border, "REVIEW" badge)
- `.tier-hygiene` (muted gray, collapsed by default)
- `.judge-reasoning` (expandable detail showing two-judge consensus)
- `.confidence-badge` (numeric, color-coded — green ≥0.8, yellow
  0.5-0.79, red <0.5)
- `.rubric-verdicts` (per-dimension breakdown for rubric findings)

### `src/report/pdf-exporter.ts`

If the PDF renders via the same HTML, the tiers carry over for free.
If the PDF generation has its own logic, mirror the tier structure.

## Files to create

### `src/report/finding-reader.ts`

```typescript
import type { Finding } from '../types/finding.js';

/**
 * Read findings from disk for the report. Returns the three tiers
 * separately, ready for templating.
 */
export interface ReportTiers {
  main: Finding[];          // from data/findings.jsonl
  uncertain: Finding[];     // from data/uncertain-findings.jsonl
  suppressed: Finding[];    // from data/suppressed-findings.jsonl (for the suppressed audit-log section)
  hygiene: HygieneEntry[];  // from data/hygiene.jsonl (A's scope-filter output)
}

export interface HygieneEntry {
  url: string;
  reason: string;
  source: 'scope-filter' | 'shopify-status' | 'other';
}

export async function readReportTiers(
  dataDir: string = 'data'
): Promise<ReportTiers>;
```

Behavior:
- Read each JSONL file if it exists; return empty arrays for missing files
- Don't throw on partial data (a missing uncertain-findings.jsonl just
  means K wasn't enabled)
- Validate basic shape (each line parses as JSON, has expected fields)
- Log any malformed lines to stderr without failing the whole read

## Tests

### `tests/unit/finding-reader.test.ts`

- positive: all four files present → correct tier counts
- positive: only findings.jsonl present (no K, no hygiene) → main
  populated, others empty
- positive: malformed line in one file → skipped, others still read
- edge: data directory missing → all empty arrays, no error

### `tests/unit/html-builder.test.ts` (extend the existing test)

- positive: report contains three section headers ("Main findings",
  "Needs review", "Hygiene")
- positive: a finding with `crop.path` renders an `<img>` referencing
  that path
- positive: a finding in the uncertain tier has the REVIEW badge
- positive: the hygiene section is collapsed by default
  (has the `details` element, closed)
- positive: confidence badge color matches the threshold

### Snapshot test

Generate a sample report from a fixture set covering all three tiers
and a mix of finding shapes (rubric, deterministic, two-judge). Assert
the rendered HTML matches a checked-in snapshot. Update the snapshot
when intentional changes happen.

## Success criteria

- `npm run test:unit` passes (target ~1500, K landed at 1476, plus
  ~25 new L tests).
- `npx tsc --noEmit` clean.
- A dry-run produces an audit-report HTML containing all three tiers
  (or empty placeholders for tiers with no entries).
- Every finding card with a crop displays the tight element crop, not
  a hero shot. Verify visually with a sample.
- The hygiene section is present, collapsed by default, lists at
  least the scope-filter exclusions A added (DRAFT products, copy-of-*).
- The uncertain section shows judge reasoning when expanded.
- Backward compat: if no findings.jsonl or uncertain-findings.jsonl
  exists (rebuild not yet active), the report still renders the legacy
  bugs.jsonl-based content correctly. L doesn't break running audits.

## Boundaries — do not

- Modify `src/scoring/`, `src/dedupe/`. The report still consumes
  ScoredBug for backward compat; L adds Finding-aware rendering
  alongside.
- Modify M1's Finding type or J/K's gate logic.
- Add a fourth tier. Three is the design.
- Auto-publish or share the report anywhere. L generates the HTML;
  distribution is unchanged.
- Add interactivity that requires a backend (no API calls from the
  rendered HTML; it's a static artifact).
- Touch personas.
- Modify `src/types.ts` or `src/types/finding.ts`.

## Reference

- `src/report/html-builder.ts` for the existing rendering
- `src/report/screenshot-cropper.ts` (H modified) for the crop tier
- `src/findings/collector.ts` (M1) and `src/gate/batch.ts` (J + K)
  for what the data files contain
- The May 28 audit PDF for "what reviewers see" — the comparison point
- `docs/check-author-guide.md` for Finding semantics
- A's scope-filter output to understand the hygiene tier

## PR convention

Title: `worktree-L: three-tier report display + element-crop rendering`

Description must include:
- Files added (`src/report/finding-reader.ts`, tests)
- Files modified (html-builder, screenshot-cropper, styles, pdf-exporter
  if applicable)
- Before/after screenshots of the report (attach images): old hero-shot
  card vs new element-crop card; main-only report vs three-tier report
- A sample generated audit-report.html from a dry-run with the three
  tiers populated
- Test count delta
- Any pre-existing reporting code the worktree had to work around (the
  v1 BugRecord/ScoredBug path coexists with the v2 Finding path during
  this transition; document the bridging logic)

## Open assumptions to verify

1. Whether `src/report/html-builder.ts` already templates findings in
   a way that can be extended for three tiers, or whether it needs a
   restructure. Read it first.
2. Whether the report currently reads from `data/bugs.jsonl` (via
   ScoredBug) or from `data/findings.jsonl`. Probably the former. L
   adds Finding-awareness as an alongside path, not a replacement.
3. Whether there's an existing CSS file or whether styles are inline
   in html-builder.ts. Don't introduce a new CSS framework; match the
   existing style.
4. Whether the snapshot-test pattern already exists elsewhere in the
   repo. If yes, follow it. If not, use a simple
   `expect(html).toContain(...)` set of assertions and document the
   reasoning.
5. Whether the PDF exporter generates from the HTML (free tier upgrade)
   or has its own path (requires a parallel change).
