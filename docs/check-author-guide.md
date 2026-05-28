# Check Author Guide

For anyone writing a new check in this repo (deterministic, rubric-driven,
cross-page, visual-regression, or journey). Read this before you start. The
contracts here are what makes parallel worktree work integrate without
collision.

## What a check is

A check is a function that examines a page, URL, or set of pages and emits
zero or more `Finding` objects into the run's findings stream. Checks live
under `src/`:

- `src/checks/*.ts` for page-level deterministic checks (Playwright)
- `src/cross-page/*.ts` for checks that span multiple URLs
- `src/visual-regression/*.ts` for baseline-diff checks
- `tests/journeys/*.ts` for scripted user journeys with in-flow assertions

## The Finding contract

Every check emits `Finding` objects matching the interface in
`src/types/finding.ts`. Required fields: `id`, `fingerprint`, `runId`,
`discoveredAt`, `ruleId`, `category`, `source`, `severity`, `url`, `title`,
`description`, `confidence`.

Strongly recommended for any check that points at a specific UI element:
`element`, `crop`. Without these the reviewer can't tell what's flagged and
the rubric judges have no grounding substrate.

If your check produces findings without crops (cross-page checks often do),
leave `crop` undefined. Worktree H backfills crops where possible.

## Naming

- `ruleId` is namespaced `category:slug`, e.g. `revenue:cart-subtotal-missing`.
- `category` is one of: `revenue`, `seo`, `content`, `network`, `i18n`,
  `cross-page`, `journey`, `visual-regression`, `hygiene`.
- Pick a slug that names the issue, not the test. Good: `mixed-locale-content`.
  Bad: `language-check-failed`.

## Fingerprints

Used for dedup across runs and for the dismissal list. The fingerprint MUST
be stable across runs as long as the underlying issue is the same.

Recommended formula:
```
fingerprint = sha1(ruleId + ":" + canonicalUrl + ":" + elementSignature)
elementSignature = (element.role || "") + ":" + (element.name || "")
```

Use the accessible name, not the selector. Selectors change with theme
updates; role+name are stable.

For cross-page findings without a single element, use a synthetic signature
that captures the assertion, e.g. for "two addresses in TOS" use
`sha1("content:duplicate-address:" + tosUrl + ":" + JSON.stringify(addresses.sort()))`.

## Severity floors by source

Set the severity in the check, but know that the scoring layer may revise:

| Source                | Max at emit | Notes                                              |
|-----------------------|-------------|----------------------------------------------------|
| `deterministic`       | any         | Critical requires vision-confirmation (worktree J) |
| `rubric` (one judge)  | medium      | Critical requires two-judge agreement              |
| `rubric` (two-judge)  | any         | Critical reserved for revenue impact               |
| `cross-page`          | any         | Deterministic, treated as ground truth             |
| `journey`             | any         | Same                                               |
| `visual-regression`   | medium      | Diffs are noisy; rely on rubric for criticality    |

## Cost discipline

LLM tokens are the dominant variable cost. Rules:

1. Deterministic checks run first. Don't spend LLM tokens on a question a
   regex or DOM query can answer.
2. Rubric checks must be cropped to the element. No hero screenshots.
3. Vision confirmation runs only on critical findings, not all findings.
4. Cache resolved selectors. If a previous run found the element, replay it.
5. Cross-page layers must not call LLMs in the hot path. Use fastText,
   lychee, spaCy, and regex.

If your worktree is tempted to spend LLM tokens on every page or every
element, stop and ask in the PR. Almost always there's a cheaper signal first.

## Testing conventions

Every check needs at least:

- One positive test (input that should produce a finding)
- One negative test (input that should NOT produce a finding)
- One edge case (the failure mode your check would have missed before this
  fix). For most worktrees this is the specific bug from the audit PDF
  that motivated the check.

Place tests next to the source under `tests/<area>/<name>.test.ts`. Use the
existing test runner (the repo runs `npm run test:unit`; check `package.json`
for the actual framework before writing tests). Mock external CLIs (lychee,
fastText, Shopify GraphQL) using `nock` or `msw`; never hit live services in
unit tests. Fixtures live under `tests/fixtures/`.

## Registering a check with orchestrate

Each check exports a default async function:

```typescript
export default async function runMyCheck(ctx: CheckContext): Promise<Finding[]>
```

And appends itself to the manifest at `src/checks/index.ts`,
`src/cross-page/index.ts`, etc. The orchestrator iterates manifests by layer
and collects findings.

DO NOT modify the orchestrator core (`src/orchestrate/*`) from a feature
worktree. If you think you need to, your check probably needs a different
abstraction. Flag it on the PR.

## Visual gate compatibility

The legacy visual gate (Sonnet 4.6, asks "is this visible to shoppers?") is
still in the pipeline. Your check can:

- Opt-in (default): leave `visualGate: undefined` and the gate runs over the
  finding.
- Pre-confirm and skip: set
  `visualGate: { verdict: 'visible', reason: 'pre-confirmed by check', judgeModel: 'n/a' }`
  if your check has already done its own visual grounding.

Guidance:
- Cross-page and journey checks: opt-out (no single element to gate).
- Deterministic critical checks: opt-in (defensive).
- Rubric checks: opt-out (they already did the grounding).
- Visual-regression checks: opt-out (the diff IS the gate).

## What goes in `meta`

The `meta` field is for narrow, check-specific context that doesn't fit a
typed field. Examples:

```typescript
meta: {
  expectedLanguage: 'es',
  detectedLanguage: 'en',
  mixedBlockRatio: 0.42,
}
```

Keep it scalar. If you're nesting objects, you need a typed field on the
Finding interface, not a wider `meta`.

## When you finish a check

- Run `npm run test:unit` and confirm pass.
- Dry-run against the live site for a small URL set; confirm zero unexpected
  findings.
- Open a PR titled `worktree-X: <one-line>`.
- PR description lists: files added, files modified, env vars added (if any),
  tests added, dry-run result.
- Tag for review. Do not merge yourself.
