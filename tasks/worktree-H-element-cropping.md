# Worktree H: Element Cropping and Bounding-Box Overlays

## Mission

Replace hero-page screenshots with element-level crops in every place a
finding produces visual evidence. Each crop is a tight bounding box around
the flagged element, with N pixels of padding and a drawn rectangle
overlay. The same artifact serves two consumers:

1. The HTML/PDF report — reviewer sees exactly what's flagged, not a
   hero shot of the whole page.
2. Downstream LLM judgment (worktrees I, J) — vision passes get a focused
   region with a labeled box, not 2MB of full-page noise.

This is the largest single refactor in the rebuild because it touches
every check that emits findings with screenshots. Do it alone, off main,
in a single worktree.

## Why

The audit PDF that motivated the rebuild had a consistent reviewer
complaint: reports show full-page hero shots where the reader can't tell
what's being flagged. The visual evidence is too far from the issue.

Beyond UX, the LLM grounding research is decisive: feeding the model a
hero shot and asking "find the bug" is the worst possible prompt. Feeding
the model a cropped element with a labeled bounding box converts grounding
from coordinate guessing (poor accuracy) to multiple-choice (high
accuracy). Set-of-Mark-style overlays improved GPT-4V's RefCOCOg score
from 25.7 to 86.4. Web-UI agents don't see that full delta but they see
a meaningful one when crops are grounded on accessibility-tree refs.

Worktrees I (rubric checks), J (vision confirmation gate), and K
(two-judge routing) all depend on H's crops as their grounding substrate.
H is the foundation for the accuracy step-change.

## Files to create

### `src/crops/types.ts`

```typescript
import type { ElementCrop } from '../types/finding';

/**
 * Per-crop generation config. Most consumers should accept defaults.
 */
export interface CropConfig {
  /** Padding in CSS pixels around the element bounds. Default 16. */
  paddingPx?: number;
  /** Whether to draw a bounding box overlay on the crop. Default true. */
  drawBoundingBox?: boolean;
  /** Bounding box color (CSS color string). Default "#ff3b3b". */
  boundingBoxColor?: string;
  /** Bounding box stroke width in pixels. Default 3. */
  boundingBoxWidth?: number;
  /** Output PNG quality (0-1). Playwright default is fine. */
  quality?: number;
  /** Max crop dimensions (width x height) in pixels. Default 1600x1200.
   *  Crops larger than this are scaled down preserving aspect ratio. */
  maxDimensions?: { width: number; height: number };
}

/**
 * A locator for the element to crop. Either a Playwright Locator (preferred)
 * or an explicit bounding box (when the caller already computed it).
 */
export type CropTarget =
  | { kind: 'locator'; locator: import('playwright').Locator }
  | { kind: 'boundingBox'; box: { x: number; y: number; width: number; height: number } };
```

### `src/crops/capture.ts`

```typescript
import type { Page } from 'playwright';
import type { ElementCrop } from '../types/finding';
import type { CropConfig, CropTarget } from './types';

/**
 * Capture a cropped, annotated screenshot of the target element.
 *
 * @param page The Playwright page (must already be at the right URL +
 *             viewport + scroll position; this function does not navigate).
 * @param target Element or bounding box to crop around.
 * @param outputPath Where to write the PNG. Caller's responsibility to
 *                   build the path; see "Path convention" below.
 * @param config Crop config; defaults applied when fields are omitted.
 * @returns The ElementCrop metadata to attach to the Finding.
 */
export async function captureCrop(
  page: Page,
  target: CropTarget,
  outputPath: string,
  config?: CropConfig
): Promise<ElementCrop>;
```

Behavior:

1. Resolve the target to a bounding box in CSS pixels. For a Locator,
   use `locator.boundingBox()`. If the locator is not visible or has
   zero area, throw a clear error (`ElementNotVisibleError`); do not
   fall back to a full-page screenshot.
2. Expand the box by `paddingPx` on all sides, clamped to viewport
   bounds (don't try to capture pixels off-screen).
3. Take a screenshot using Playwright's `page.screenshot({ clip: ... })`
   with the expanded box. This avoids capturing the full page just to
   crop it down.
4. If `drawBoundingBox` is true, draw a rectangle on the resulting PNG
   matching the ORIGINAL (un-padded) element bounds, in pixel coordinates
   relative to the crop. Use the pngjs + node-canvas pattern that
   worktree F already pulled in, or use sharp if it's available.
5. If the crop exceeds `maxDimensions`, scale down preserving aspect
   ratio. (Some elements span the full page height; crops shouldn't be
   multi-megabyte.)
6. Write to `outputPath`. Return ElementCrop metadata: `{ path,
   width, height, padding, boundingBoxDrawn }`.

### `src/crops/path.ts`

```typescript
import type { Finding } from '../types/finding';

/**
 * Canonical path for a finding's crop within the output directory.
 *
 *   <outputDir>/crops/<runId>/<findingId>.png
 *
 * Keeps crops grouped per run, easy to clean up, and the path mirrors
 * the Finding ID so debugging is trivial.
 */
export function cropPath(outputDir: string, finding: Pick<Finding, 'id' | 'runId'>): string;
```

### `src/crops/errors.ts`

```typescript
export class ElementNotVisibleError extends Error {
  constructor(public locator: string) {
    super(`Element not visible or zero-size: ${locator}`);
    this.name = 'ElementNotVisibleError';
  }
}
```

### `src/crops/index.ts`

Barrel export.

## Files to modify

This is the big surface. Each of these places currently produces a
hero-page screenshot for findings. Each gets switched to use `captureCrop`
where an element-level finding is being emitted.

For each one: locate the screenshot call, identify the element the finding
points at (most checks already have a locator handy), replace the
full-page capture with a crop call, attach the resulting `ElementCrop` to
the finding's `crop` field. Leave `fullPageScreenshotPath` as a fallback
for debugging but stop relying on it for reports.

The check modules that need this treatment (verify each against current
code; some may already have moved partially):

- `src/checks/revenue.ts` — cart-summary findings, ATC button findings
- `src/checks/seo.ts` — missing title, missing meta description findings
- `src/checks/jsonld.ts` — schema validation failures, point at the
  `<script type="application/ld+json">` element
- `src/checks/opengraph.ts` — same pattern for OG tags
- `src/checks/network.ts` — for findings tied to a specific image or
  link element on the page (NOT for analytics beacons; those aren't
  visible and shouldn't crop)
- `src/checks/image.ts` — broken images get cropped to the img element
- `src/checks/currency.ts` — price element crops
- `src/checks/search.ts` — search result element crops
- `src/checks/newsletter.ts` — newsletter form crops
- `src/checks/external-links.ts` — link element crops
- `src/checks/tap-targets.ts` — the too-small button element
- `src/checks/console.ts` — DO NOT crop. Console errors have no DOM
  element. Leave `crop: undefined`.
- `src/checks/visual.ts` — this one's tricky. It currently captures
  full-page shots as the primary artifact. After H, it still produces
  full-page shots for visual regression (F's layer needs them) but
  any finding it emits about a specific issue should also have a crop.

The persona discovery (`src/personas/*`) and orchestrate pipeline are out
of scope — they don't currently produce element-level findings, just
free-form bug reports. Worktree I refactors those into rubric checks
that will use crops natively.

## Files to modify (reporting)

- `src/report/html.ts` (or wherever the HTML report generates) — switch
  the `<img>` source from `fullPageScreenshotPath` to `crop.path`. Keep
  a tooltip or expander to show the full page on demand if reviewers
  want context.
- `src/report/pdf.ts` if separate — same pattern.
- `web/` if there's a browseable UI — same pattern.

For findings WITHOUT a crop (console errors, cross-page checks, journey
findings), the report needs to handle the absent crop gracefully. Show a
placeholder or just the text, don't try to embed a missing image.

## Tests

`tests/crops/capture.test.ts`:
- positive: a visible element with a Locator → returns ElementCrop with
  expected dimensions (locator box + 2*padding, clamped to viewport)
- positive: padding applied correctly when element near viewport edge
  (clamp behavior verified)
- positive: bounding box drawn when `drawBoundingBox: true` (verify by
  reading the output PNG and checking for the box color in expected
  pixel positions)
- positive: maxDimensions scaling preserves aspect ratio
- negative: invisible element throws `ElementNotVisibleError`
- negative: zero-size element throws `ElementNotVisibleError`
- edge: element extends below viewport — clamp to viewport bottom

`tests/crops/path.test.ts`:
- builds the canonical path
- different runIds produce non-colliding paths
- different findingIds within a run produce non-colliding paths

`tests/integration/crop-end-to-end.test.ts`:
- Spin up a tiny static page, point Playwright at a known element, call
  `captureCrop`, verify the output PNG exists, has the expected
  dimensions, and has the box overlay where expected.

For the check-module modifications, each touched check needs at least one
test asserting its findings now carry a non-undefined `crop` with a valid
path. Don't add a separate test file; extend the check's existing test
file with one assertion per affected check.

## Migration strategy

This worktree is large enough that landing it as one giant PR is risky.
Recommend three commits within the single worktree, each verifiable on
its own:

**Commit 1: scaffold.** Add `src/crops/*` files and tests. Nothing
imports them yet. Tests pass standalone. PR-able as a standalone first
slice if you want to land it early.

**Commit 2: migrate checks.** Update every check module to use
`captureCrop` and attach crops to findings. Tests for each check
updated. Old full-page screenshot code can stay temporarily; just stop
relying on it for the report.

**Commit 3: report swap.** Switch the report generators from
`fullPageScreenshotPath` to `crop.path`. Remove the now-unused full-page
screenshot capture paths from checks (but keep `fullPageScreenshotPath`
field on Finding for debugging use). Update integration tests that
asserted on report contents.

Open one PR with all three commits; reviewer can step through them
sequentially.

## Success criteria

- `npm run test:unit` passes after each commit.
- A dry-run audit produces a report where every finding with an
  element-level issue shows a tight crop with a visible bounding box,
  NOT a hero shot.
- A finding without an element (console error, cross-page consistency
  finding) renders gracefully in the report without a broken image.
- Crop file sizes are reasonable. Compare: a previous hero shot from
  the May 28 audit run is probably 200-800KB. A crop of an actual
  element should typically be 20-100KB. If your crops are routinely
  >500KB, your `maxDimensions` is wrong or you're capturing too much.
- The Finding shape on emit conforms to v2: `crop` populated for
  element-level findings, `crop: undefined` for findings without an
  element, `fullPageScreenshotPath` retained but not relied upon.

## Reference

- `src/types/finding.ts` — Finding and ElementCrop shapes
- `docs/check-author-guide.md` — crop conventions, visual gate compatibility
- `docs/operational-constraints.md` — Cloudflare/O2O constraint
- Playwright `page.screenshot({ clip })` docs:
  https://playwright.dev/docs/api/class-page#page-screenshot
- Worktree F's `src/visual-regression/capture.ts` for an example of
  Playwright clipped screenshots in this repo
- The audit PDF from May 28 for examples of the hero-shot problem the
  reviewer complained about

## Boundaries — do not

- Modify orchestrate's pipeline order. Worktree H changes what findings
  carry, not how they flow.
- Modify the personas (`src/personas/*`). Worktree I replaces them with
  rubric checks.
- Modify the Finding interface (`src/types/finding.ts`). It already has
  `crop: ElementCrop` and `fullPageScreenshotPath`. If you discover a
  shape gap, surface on PR; do not unilaterally extend.
- Add new severities or rule IDs.
- Touch the cross-page or journey layers; those don't have single
  elements to crop and shouldn't gain crops in this worktree.
- Replace the visual regression layer's full-page captures (those serve
  a different purpose — F needs full pages for template diffs).
- Auto-install image libraries that aren't already in the lockfile. If
  you need sharp or canvas, justify on the PR.

## PR convention

Title: `worktree-H: element cropping and bounding-box overlays`

Description must include:
- Files added (src/crops/*, tests)
- Files modified (every check module touched, every report file
  touched) — paste the count
- Sample crops: attach 3-5 actual crop PNGs from a dry-run, showing
  representative findings across categories
- Before/after report comparison: 1-2 sentences on what the report
  looked like before this worktree and what it looks like after
- Crop file size stats: median, p95 from the dry-run
- Test count delta

## Open assumptions to verify

1. Whether `pngjs` and `pixelmatch` (already pulled in by worktree F) are
   sufficient to draw a bounding box on a PNG, or whether sharp/canvas is
   needed. Verify by trying pngjs first; it's already in the lockfile.
2. Where the HTML report generator lives. The brief assumes `src/report/`;
   confirm against the actual repo structure (per the post-A learnings,
   check src/scripts/ and scripts/ as well).
3. Whether the existing checks already produce a locator for the
   element they're flagging, or whether some checks only know the URL.
   If a check has no element locator handy, leave its `crop` undefined
   and document on the PR rather than synthesizing one.
4. Whether Playwright's `page.screenshot({ clip })` works correctly when
   the clip extends below the natural viewport (need to either scroll
   the element into view first or accept that the clip will be empty).
   Test on a tall element early.
