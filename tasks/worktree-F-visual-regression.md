# Worktree F: Visual Regression Scaffolding (Template Baselines)

## Mission

Stand up template-level visual regression diffing using Playwright's
built-in screenshot capture plus a baseline store, with masked dynamic
regions and a per-template approach (not per-URL). This is scaffolding,
not full deployment: get the capture + diff + mask config working locally
and emit findings; the GCS-backed baseline store and approval workflow
follow later.

## Why

Strategy doc identified visual regression as the right tool for "what
does good look like" but only with template-level baselines. Per-URL pixel
baselines across 193 pages are a maintenance trap. Template-level (~30
baselines: 8-12 templates × 3 viewports) is tractable.

This worktree builds the scaffold. It does NOT need to be production-ready;
it needs to be a working prototype the team can iterate on.

## Files to create

### `src/visual-regression/templates.ts`

Define the template list. Each template names a representative URL.

```typescript
export interface Template {
  /** Stable template ID, e.g. "pdp", "collection". */
  id: string;
  /** Human label. */
  label: string;
  /** Representative URL for capture. */
  representativeUrl: string;
  /** Viewports to capture. */
  viewports: ('desktop' | 'tablet' | 'mobile')[];
  /** Selectors to mask before capture (dynamic regions). */
  maskSelectors: string[];
  /** Optional pre-capture wait, ms, beyond default. */
  extraWaitMs?: number;
}

export const TEMPLATES: Template[] = [
  {
    id: 'homepage',
    label: 'Homepage',
    representativeUrl: 'https://www.ryzesuperfoods.com/',
    viewports: ['desktop', 'tablet', 'mobile'],
    maskSelectors: [
      '[data-countdown]',
      '.countdown',
      '[data-viewers]',
      '[aria-label*="viewers"]',
    ],
  },
  {
    id: 'pdp',
    label: 'Product detail page',
    representativeUrl: 'https://www.ryzesuperfoods.com/products/ryze-mushroom-coffee',
    viewports: ['desktop', 'tablet', 'mobile'],
    maskSelectors: [
      '[data-countdown]',
      '.countdown',
      '.reviews-count',  // review count changes daily
    ],
  },
  {
    id: 'collection',
    label: 'Collection / shop-all',
    representativeUrl: 'https://www.ryzesuperfoods.com/pages/shop-all',
    viewports: ['desktop', 'tablet', 'mobile'],
    maskSelectors: ['[data-countdown]', '.countdown'],
  },
  {
    id: 'cart',
    label: 'Cart',
    representativeUrl: 'https://www.ryzesuperfoods.com/cart',
    viewports: ['desktop', 'tablet', 'mobile'],
    maskSelectors: ['[data-countdown]', '.countdown'],
    // Cart may need ATC pre-step; document if so.
  },
  {
    id: 'blog-post',
    label: 'Blog post',
    representativeUrl: 'https://www.ryzesuperfoods.com/blogs/recipes/ryze-affogato',
    viewports: ['desktop', 'mobile'],
    maskSelectors: ['[data-countdown]'],
  },
  {
    id: 'policy',
    label: 'Policy page',
    representativeUrl: 'https://www.ryzesuperfoods.com/policies/terms-of-service',
    viewports: ['desktop', 'mobile'],
    maskSelectors: [],
  },
  {
    id: 'landing-locale-es',
    label: 'Spanish locale landing',
    representativeUrl: 'https://www.ryzesuperfoods.com/pages/mushroom-coffee-espanol',
    viewports: ['desktop', 'mobile'],
    maskSelectors: ['[data-countdown]'],
  },
];
```

Templates are intentionally a starting list. The team will edit as they
identify others (offer pages, bridge pages, etc.).

### `src/visual-regression/capture.ts`

```typescript
import type { Browser } from 'playwright';
import type { Template } from './templates';

export interface CaptureConfig {
  baselineDir: string;        // local path, e.g. "./baselines"
  outputDir: string;          // where current-run shots go, e.g. "./output/visual"
  isBaseline: boolean;        // true to overwrite baseline, false to compare
}

export interface CaptureResult {
  template: string;
  viewport: string;
  path: string;
  /** True if this was a baseline write rather than a comparison. */
  baselineWritten: boolean;
}

export async function captureTemplate(
  browser: Browser,
  template: Template,
  config: CaptureConfig
): Promise<CaptureResult[]>;
```

Behavior:
- For each viewport in the template, launch a new context at the right size.
- Navigate to `representativeUrl`. Wait for `networkidle` + `extraWaitMs`.
- Inject CSS to hide everything matching `maskSelectors` (use
  `visibility: hidden` so layout is preserved). Alternative:
  Playwright `mask` option on `screenshot()` paints masks solid.
- Take a full-page screenshot.
- If `isBaseline`, write to `<baselineDir>/<template.id>-<viewport>.png` and
  return `baselineWritten: true`.
- Otherwise, write to `<outputDir>/<template.id>-<viewport>.png` and return
  `baselineWritten: false`.

### `src/visual-regression/diff.ts`

```typescript
import type { Finding } from '../types/finding';

export interface DiffConfig {
  baselineDir: string;
  currentDir: string;
  /** Tolerance for diff before firing. */
  maxDiffPixelRatio?: number;  // default 0.01
  threshold?: number;           // pixelmatch threshold, default 0.2
}

export interface DiffResult {
  template: string;
  viewport: string;
  diffPath: string | null;       // path to written diff image, null if no diff
  diffPixelRatio: number;
  findings: Finding[];
}

export async function diffTemplate(
  template: string,
  viewport: string,
  config: DiffConfig,
  runId: string
): Promise<DiffResult>;
```

Behavior:
- Use `pixelmatch` (already a Playwright transitive dependency).
- Load `<baselineDir>/<template>-<viewport>.png` and
  `<currentDir>/<template>-<viewport>.png`.
- If baseline doesn't exist, emit a finding `visual-regression:baseline-missing`
  with `severity: 'medium'` and `confidence: 1.0`. Don't fail; surface it.
- Run pixelmatch with `threshold`.
- If diff pixel ratio > `maxDiffPixelRatio`:
  - Write diff PNG to `<currentDir>/<template>-<viewport>.diff.png`.
  - Emit a Finding:
    - `ruleId: 'visual-regression:template-changed'`
    - `category: 'visual-regression'`
    - `source: 'visual-regression'`
    - `severity: 'medium'` (visual diffs are noisy; rubric layer escalates)
    - `title: "Visual regression on <template> at <viewport>"`
    - `description`: ratio, baseline path, current path
    - `fingerprint: sha1('visual-regression:' + template + ':' + viewport)`
    - `confidence: 0.5` (the diff is real, but whether it's meaningful is
      uncertain; flag for review)
    - `uncertain: true` (route to uncertain tier by default)
    - `meta: { diffPixelRatio, baselinePath, currentPath, diffPath }`

### `src/visual-regression/index.ts`

Thin orchestrator:

```typescript
export async function runVisualRegression(
  config: CaptureConfig & DiffConfig,
  runId: string
): Promise<Finding[]>;
```

- For each template, capture current shots.
- Diff against baselines.
- Return aggregated findings.
- If `isBaseline: true`, capture only (no diff, no findings).

### `scripts/baseline-update.ts`

A small CLI script the team runs to refresh baselines:

```
npx tsx scripts/baseline-update.ts [template-id...]
```

If no template IDs are passed, refreshes all baselines. If one or more are
passed, refreshes only those. Prints what it wrote. Does NOT auto-commit;
baselines should be reviewed before committing.

## GCS deferred

The strategy doc calls for GCS-backed baselines (via reg-suit). For this
worktree, baselines live locally under `./baselines`. The interface is
designed so swapping to GCS later is a config change.

Document on the PR: GCS migration is out of scope for this worktree;
follow-up task should swap `baselineDir` to a GCS path adapter.

## Tests

`tests/visual-regression/diff.test.ts`:
- positive: identical baseline + current → 0 findings
- positive: baseline + clearly different current (different background
  color) → 1 finding with high diffPixelRatio
- negative: small noise (1-2 pixels) below threshold → 0 findings
- edge: baseline missing → `visual-regression:baseline-missing` finding,
  no throw

`tests/visual-regression/templates.test.ts`:
- TEMPLATES array has no duplicate IDs
- Every template has at least one viewport
- All `maskSelectors` are valid CSS selector syntax

Capture is hard to unit-test without a real browser; defer to manual
verification.

## Dependencies

`pixelmatch` and `pngjs` are likely already pulled in transitively via
Playwright. Confirm; add direct dependencies if needed:

```json
{
  "dependencies": {
    "pixelmatch": "^5.3.0",
    "pngjs": "^7.0.0"
  }
}
```

## Success criteria

- `npm run test:unit` passes for the deterministic tests.
- `npx tsx scripts/baseline-update.ts homepage` captures fresh
  baselines for the homepage template across viewports.
- A second run with `runVisualRegression` against unchanged site produces
  zero findings.
- A manually-introduced visual change (e.g. modify the URL to a different
  page) produces a finding.
- No changes outside `src/visual-regression/`, `tests/visual-regression/`,
  `scripts/baseline-update.ts`, `package.json`.

## Reference

- Playwright screenshot masking:
  https://playwright.dev/docs/api/class-page#page-screenshot
- pixelmatch: https://github.com/mapbox/pixelmatch
- The strategy doc's Layer 4 description for the desired end state.
- `src/types/finding.ts`
- `docs/check-author-guide.md`

## Boundaries — do not

- Implement GCS baseline storage in this worktree (deferred)
- Add a UI for approving baselines (deferred; the manual script is
  sufficient for MVP)
- Modify check modules
- Modify orchestrate
- Implement LLM-based semantic diffing (a later strategic task)
- Capture per-URL baselines. Per-template only.

## PR convention

Title: `worktree-F: visual regression scaffolding`

Description must list:
- Files added
- Templates included in the initial list
- Dry-run output: baseline write + second-run zero-finding pass
- Known limitations (GCS deferred, approval workflow deferred)
- Recommendation for which templates to add next based on PMs' priorities

## Open assumptions to verify

1. Whether the existing `checks/visual.ts` already captures per-page
   screenshots in a way that conflicts with this worktree. Read it;
   coordinate naming if so.
2. Playwright is set up with the right viewports already. Confirm.
3. Whether the team wants to baseline shop. subdomain pages too. If so,
   add them to TEMPLATES.
