# Worktree N2: Dashboard Rendering of Structured Findings + Crops

## Mission

Update the Firebase-hosted dashboard at live-qa-agent.web.app to
render the v2 Finding stream and per-finding crops that N1 just made
available. New components for findings list + finding detail, tabbed
view by tier (Main / Uncertain / Suppressed / Hygiene), inline crop
images, confidence badges, two-judge reasoning expansion. Integrated
into the existing RunDetail page.

This is the dashboard half of Phase 2. After N2 lands and gets
deployed, opening the dashboard for a recently-completed run shows the
rebuilt audit's structured output — not just a link out to the
pre-rendered HTML report.

## Why

The static HTML report (worktree L) ships the new tiers, crops, and
confidence to reviewers who open the file. The dashboard is a parallel
surface that the rest of the team uses for run management, history,
and diff. Until N2, the dashboard only links out to the rendered HTML
and shows a small counts strip from `scored-bugs.json`. After N2, the
dashboard surfaces every accuracy improvement directly: tight element
crops as inline images, confidence-tiered separation, expandable judge
reasoning, the hygiene exclusions A built.

The data is already in Storage and Firestore (per N1). N2 is purely
client-side: types, fetch helpers, components, integration.

## Prerequisite

N1 must be merged and deployed (the daemon running with N1's code) for
the new files and fields to exist on real runs. N2 can be built in
isolation against fixtures, but the final dry-run verification needs
real data.

If N1 isn't deployed yet at N2 build time, the session can either:
- Build entirely against fixtures and document that the live dry-run
  is gated on N1 deployment
- Wait for N1 to merge first (recommended for clean staging)

Session's call based on N1's deployment timing.

## Files to modify

### `web/lib/schema.ts`

Add types mirroring the audit pipeline's shapes. Source the field
list from `src/types/finding.ts` in the main repo.

```typescript
// New types (add to schema.ts)
export type FindingSource = 'deterministic' | 'rubric' | 'persona' | 'journey' | 'cross-page' | 'visual-regression';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ElementCrop {
  path: string;        // relative path within reports/{runId}/crops/, e.g. "f-xyz123.png"
  width: number;
  height: number;
  padding: number;
  boundingBoxDrawn: boolean;
}

export interface ElementRef {
  selector?: string;
  role?: string;
  name?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface VisualGate {
  verdict: 'visible' | 'not-visible' | 'uncertain';
  reason: string;
  judgeModel: string;
}

export interface RubricVerdict {
  dimension: string;
  verdict: 'pass' | 'fail' | 'uncertain';
  confidence: number;
  discrepancy?: string;
}

export interface Finding {
  id: string;
  fingerprint: string;
  runId: string;
  discoveredAt: string;
  ruleId: string;
  category: string;
  source: FindingSource;
  severity: FindingSeverity;
  url: string;
  relatedUrls?: string[];
  title: string;
  description: string;
  confidence: number;
  element?: ElementRef;
  crop?: ElementCrop;
  fullPageScreenshotPath?: string;
  visualGate?: VisualGate;
  rubricVerdicts?: RubricVerdict[];
  meta?: Record<string, string | number | boolean | null>;
}

export interface HygieneFinding {
  id: string;
  runId: string;
  discoveredAt: string;
  reason: string;       // 'shopify-status:draft' | 'deny-pattern' | etc.
  url: string;
  detail?: string;
}
```

Extend the existing `Run` type with the new fields N1 writes:

```typescript
// Add to existing Run interface
findingsJsonPath?: string;
uncertainFindingsJsonPath?: string;
suppressedFindingsJsonPath?: string;
hygieneJsonPath?: string;
cropsPrefix?: string;
findingsCount?: number;
uncertainCount?: number;
suppressedCount?: number;
hygieneCount?: number;
cropsCount?: number;
```

### `web/lib/runs.ts`

Add fetch helpers. Mirror how `useDiffRequest` (or wherever
`scored-bugs.json` is fetched) downloads and parses Storage JSON.

```typescript
/**
 * Fetch a Storage JSONL artifact and parse it line by line.
 * Returns empty array if the gsPath is absent or the file 404s.
 */
export async function fetchFindings(gsPath: string | undefined): Promise<Finding[]>;
export async function fetchHygiene(gsPath: string | undefined): Promise<HygieneFinding[]>;

/**
 * Build a getDownloadURL for a crop file given the run's cropsPrefix
 * and the finding's crop.path. Caches results to avoid repeat calls
 * within a session.
 */
export function useCropUrl(
  cropsPrefix: string | undefined,
  cropPath: string | undefined
): { url: string | null; loading: boolean; error?: Error };
```

The crop URL is built once per crop. If the dashboard renders 50
finding cards on one page, that's 50 `getDownloadURL` calls in
parallel. Each call is a token-signed URL generation (no Storage data
transfer). Cheap. The actual PNG download happens lazily when the
`<img>` mounts.

### `web/components/RunDetail.tsx`

Integrate findings into the existing run detail page. Below the
telemetry grid (status, progress, URLs, bugs, elapsed):

1. **Counts strip update.** Add `findingsCount`, `uncertainCount`,
   `suppressedCount`, `hygieneCount` to the visible counters. If
   undefined (older run before N1), show legacy fields only.

2. **New "Findings" section** with tabs:
   - Main (`findingsCount` items from `findingsJsonPath`)
   - Needs review (`uncertainCount` from `uncertainFindingsJsonPath`)
   - Suppressed (`suppressedCount` from `suppressedFindingsJsonPath`,
     collapsed by default per the static-report pattern)
   - Hygiene (`hygieneCount` from `hygieneJsonPath`, collapsed by
     default)
   - Hide a tab entirely if its count is 0 and its path is undefined
     (legacy runs)

3. Each tab renders a list of `<FindingCard>`s lazily (load findings
   only when the tab is active to avoid wasted network).

### Files to create

#### `web/components/FindingCard.tsx`

A single finding card. Displays:
- Severity badge (color-coded: critical=red, high=orange, medium=yellow, low=gray)
- Title
- Inline crop image (if `crop.path` exists) at a sensible display size
  (max-width ~400px, lazy loaded)
- Confidence badge (color: green ≥0.8, yellow 0.5-0.79, red <0.5)
- URL
- Description (truncated, expandable)
- For uncertain tier: collapsed `<details>` showing two-judge
  reasoning (from `visualGate.reason`)
- For rubric source: collapsed `<details>` showing per-dimension
  `rubricVerdicts`
- ruleId in a small monospace badge

#### `web/components/FindingsList.tsx`

A list of `<FindingCard>`s with optional grouping and filtering. Initial
filters:
- By severity (multi-select)
- By category (multi-select)
- By source (multi-select)

Filters are local state, not URL-synced for now (URL sync is a future
enhancement).

#### `web/components/HygieneEntry.tsx`

A compact row for hygiene exclusions:
- URL (truncated, monospace)
- Reason (e.g. "Shopify status: draft", "matched deny pattern copy-of-*")
- Optional detail

A simple list, not cards. Hygiene is reference material, not bugs.

## Tests

The dashboard doesn't appear to have a test suite based on the
investigation (no test files mentioned under web/). If web/package.json
shows a test script, use it. Otherwise, follow these:

- Add a few unit tests for the parser helpers in
  `web/lib/runs.ts` (parsing JSONL, handling missing files, etc.)
  using whatever test runner the web/ package supports. If none, add
  vitest as a devDependency (vitest is the standard for Next 16) and
  document the new test command in web/CLAUDE.md.
- Skip full component tests if the project has no precedent. A real
  dry-run against a recent N1-produced run is the integration test.

## Success criteria

- `npm run build` in web/ succeeds (Next 16 static export).
- `npm run lint` in web/ clean.
- After `firebase deploy --only hosting`, opening
  https://live-qa-agent.web.app and navigating to a recent run shows:
  - Main findings tab with structured cards, each with inline crop
    images
  - Uncertain tab with the REVIEW badge and expandable judge reasoning
  - Suppressed tab (collapsed by default) showing items the gate
    refuted
  - Hygiene tab (collapsed by default) showing A's exclusions
  - Filters work for severity, category, source
- The existing dashboard pages (RunList, OutputsPage, DiffView,
  ScanConfigModal) still work exactly as before.
- Older runs without N1's new fields still render — the new sections
  hide gracefully when counts are 0/undefined.
- Auth gating unchanged (still requires @ryzewith.com).

## Boundaries — do not

- Modify Firestore rules, Storage rules, or `firebase.json` CSP.
- Modify auth flow (SignInScreen, AuthProvider).
- Modify the theme system or ThemeProvider.
- Modify ScanConfigModal — that's its own concern.
- Touch the daemon (`scripts/runner-daemon.ts`) — that's N1's surface.
- Touch the audit pipeline (`src/`) — Phase 2 is read-only on it.
- Change the search-param-based routing scheme. The findings view is
  inside the existing `?run=<runId>` URL.
- Add a backend, server functions, or API routes. The dashboard
  remains a client-only static export.
- Add deploy automation. Manual `firebase deploy` stays the convention.

## Reference

- The Firebase dashboard investigation report (full PDF) — especially
  sections 1, 4, 5, 7, 8
- `web/AGENTS.md` and `web/CLAUDE.md` — Next 16 specifics, deploy
  instructions
- `src/types/finding.ts` in the main repo — the canonical Finding type
- `web/lib/schema.ts` — existing Run type that's getting extended
- `web/lib/runs.ts` — existing hooks pattern
- `web/components/RunDetail.tsx` — the integration target
- `web/components/DiffView.tsx` — example of fetching a Storage JSON
  artifact + parsing client-side (closest existing pattern)
- N1's PR for the exact field names and gs:// path conventions

## PR convention

Title: `worktree-N2: dashboard rendering of structured findings + crops`

Description must include:
- Files added (new components, possibly test files)
- Files modified (schema.ts, runs.ts, RunDetail.tsx)
- Screenshots from a deployed preview or local dev:
  - The new Findings section in RunDetail with each tab populated
  - A crop image rendered inline
  - The uncertain tier's expanded judge reasoning
  - The hygiene tier collapsed and expanded
- Backward compat note: an older run (with no findingsJsonPath)
  renders without errors and without the new sections
- Build / lint status

## Open assumptions to verify

1. Whether `web/lib/diff.ts` or similar already has a "fetch and parse
   a Storage JSON" pattern. If so, mirror it. If the diff fetcher
   uses a specific helper for `getDownloadURL` + fetch + parse, reuse.
2. Whether `useCropUrl` should cache URLs across component remounts.
   For a session-long cache, a module-level Map keyed by gsPath is
   simplest. Test the cache behavior on tab switching.
3. The exact display size for crop images. The static report (L) uses
   max-width to fit within finding cards. Mirror that range
   (~400-600px wide max, height auto, with object-fit:contain).
4. Whether the dashboard's design system (instrument / atelier themes)
   has tokens for the new badges and tier colors. If not, add them
   following the existing theme variable pattern in `web/app/globals.css`.
5. Whether the existing RunDetail's view of `scored-bugs.json` should
   stay or be replaced by the new findings view. Recommendation: keep
   `scored-bugs.json` visible for legacy/diff continuity for now;
   findings sit alongside, not in place of. A future worktree can
   sunset scored-bugs.json when downstream is fully on v2 Findings.

## Deploy note

After N2 merges to main, the deploy is manual:

```bash
cd web && npm run build
firebase deploy --only hosting
```

The N2 PR doesn't need to deploy itself; document the deploy command
in the PR description and Ben (or whoever runs the daemon Mac) does
the deploy when ready. The Firestore/Storage rules don't change, so
no `--only firestore:rules,storage` deploy is needed.
