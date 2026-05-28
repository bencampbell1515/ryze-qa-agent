# Worktree C: Language Detection (Mixed-Locale Pages)

## Mission

Detect when a page's content doesn't match the language implied by its URL.
Examples: a `/es/...` page mostly in English, a `/fr/pages/mushroom-chicory-espanol`
page where the path says French but the content is Spanish.

## Why

Audit misses surfaced this entire class:
- `/es/fbo/mushroom-coffee-dark` with English titles ("Dark Roast",
  "Reviews", "Mushroom Coffee")
- `/es/fbo/mushroom-coffee` with English text and English photos
- `/pages/mushroom-*-espanol` pages with significant English content
- `/fr/pages/mushroom-chicory-espanol` with `/fr/` in path but Spanish content

A page-isolated, text-blind audit can't see these. A site-wide block-level
language detector with an expected-locale map catches them all cheaply.

## Files to create

### `src/cross-page/language.ts`

```typescript
import type { Finding } from '../types/finding';

export interface LanguageCheckConfig {
  /** Locale to URL path prefix map. From config/canonical-record.json
   *  localePathPrefixes. */
  localePathPrefixes: Record<string, string>;
  /** Mixed-content threshold. If the share of blocks whose detected
   *  language doesn't match the expected language exceeds this, emit a
   *  finding. Default 0.15 (15%). */
  mixedThreshold?: number;
  /** Minimum confidence to count a block as confidently detected.
   *  Default 0.6. */
  minBlockConfidence?: number;
  /** Minimum characters per block to bother detecting. Default 20. */
  minBlockLength?: number;
}

export interface LanguageCheckResult {
  expectedLanguage: string | null;  // null if URL doesn't imply a locale
  detectedLanguages: Record<string, number>;  // lang code → block count
  mixedBlockRatio: number;
  findings: Finding[];
}

export async function checkPageLanguage(
  url: string,
  pageText: string,  // visible text from the page, pre-extracted
  config: LanguageCheckConfig,
  runId: string
): Promise<LanguageCheckResult>;
```

Behavior:

1. Derive expected language from URL path using `localePathPrefixes`.
   `/es/foo` → `es`. `/fr/pages/x` → `fr`. URL with no matching prefix:
   `expectedLanguage = null`, skip the page (return empty findings).
2. Split page text into blocks: each `<p>`, `<h*>`, list item, or table cell
   is one block. Worktree should accept pre-tokenized text from the caller
   (so the Playwright capture stage decides what counts as a block).
   For the MVP, accept the text as newline-separated blocks.
3. Filter blocks shorter than `minBlockLength`.
4. Run language detection on each block. Use the `eld` npm package
   (pure-JS, no Python dep, MIT). Falls back to fastText if `FASTTEXT_MODEL_PATH`
   env var is set.
5. Count blocks per detected language.
6. Compute `mixedBlockRatio` = (blocks with detected != expected and
   confidence >= minBlockConfidence) / (total blocks above minBlockLength).
7. If `mixedBlockRatio > mixedThreshold`, emit a Finding:
   - `ruleId: 'i18n:mixed-locale-content'`
   - `category: 'i18n'`
   - `source: 'cross-page'`
   - `severity: 'high'` (mixed locale is a clear shopper-visible issue)
   - `title: "Mixed-locale content on <url>"`
   - `description`: includes expected language, dominant detected language,
     ratio, examples (first 2 offending blocks, truncated)
   - `fingerprint: sha1('i18n:mixed-locale-content:' + url + ':' + expectedLanguage)`
   - `confidence: <set to mean block confidence>`
   - `meta: { expectedLanguage, dominantDetected, mixedBlockRatio, blockCount }`
   - `visualGate: pre-confirmed visible` (no single element)
   - `relatedUrls`: if `localePathPrefixes` has a corresponding correct-locale
     equivalent URL (replace prefix), include it for reviewer context

### Optional: `src/cross-page/language-multi-signal.ts`

For higher confidence, run a second detector (`cld2` via wasm or
`langdetect`) and only fire when both agree. This is a stretch goal; if you
have time after the main path is solid, add it. If you skip it, document
on the PR.

## Tests

`tests/cross-page/language.test.ts`:
- positive: Spanish page text with 50% English blocks, expected `es` → 1
  finding with `mixedBlockRatio` around 0.5
- negative: Spanish page text 100% Spanish, expected `es` → 0 findings
- negative: URL doesn't match any locale prefix → 0 findings (skipped)
- positive: French path with Spanish content → 1 finding (this is the
  `/fr/.../-espanol` case)
- edge: page with very short text (under threshold) → 0 findings, not
  a false positive
- edge: detection confidence below `minBlockConfidence` → block doesn't
  count toward mixed ratio
- threshold tuning: ratio exactly at threshold doesn't fire (only above)

Fixtures: small `.txt` files under `tests/fixtures/language/` with sample
text for each scenario.

## Dependencies to add

```json
{
  "dependencies": {
    "eld": "^1.5.0"
  }
}
```

If you choose to add fastText (much heavier, requires native bindings),
gate it behind an env var and document the install in README.

## Success criteria

- `npm run test:unit` passes.
- A dry-run against the known-bad pages from the bug report
  (`/pages/mushroom-dark-roast-espanol`, `/es/fbo/mushroom-coffee`, etc.)
  produces findings.
- A dry-run against a known-clean Spanish page produces no false positive.
- No changes outside `src/cross-page/`, `tests/cross-page/`,
  `tests/fixtures/language/`, `package.json`.

## Reference

- `src/types/finding.ts`
- `docs/check-author-guide.md`
- `config/canonical-record.json` (`localePathPrefixes`)
- `eld` docs: https://www.npmjs.com/package/eld
- fastText lid.176: https://fasttext.cc/docs/en/language-identification.html

## Boundaries — do not

- Modify check modules
- Modify orchestrate
- Modify the page-text extraction (assume someone else hands you text;
  if no extraction exists yet, accept text as a parameter and let the
  caller do it)
- Add Python dependencies. Stay pure-JS for the MVP.

## PR convention

Title: `worktree-C: language detection for mixed-locale pages`

Description must list:
- Files added
- Tests added
- Dependency added (`eld`)
- Dry-run results: paste 3-5 findings from the known-bad pages
- A short note on detection precision/recall observed in spot-checking

## Open assumptions to verify

1. Where in the existing pipeline does page text get extracted? If
   nowhere, write a small `extractVisibleText(page: Page): Promise<string>`
   helper alongside this check, returning newline-joined block text.
2. What constitutes a "page" worth checking? Skip product pages? Include
   policy pages? Default: check everything that survives Layer 1 scope
   filtering. Document on PR if you choose differently.
