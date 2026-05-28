# Worktree D: Content Rules (Copyright, Brand Dictionary, URL Typos)

## Mission

Add three deterministic content checks that look for issues the LLM-based
pipeline missed because they require comparing page content against a
canonical reference:

1. Copyright year freshness ("© 2025" when the current year is 2026)
2. Brand-term and product-name dictionary check across visible text and URLs
3. URL typo detection (`/pages/brandambassdor` vs `brandambassador`)

## Why

Audit misses surfaced these classes:
- Outdated "© 2025" in the footer on multiple Spanish Replo pages.
- `/pages/brandambassdor` (missing the `a` in `ambassador`) live and
  scraped, no flag raised.
- Inconsistent brand naming the audit didn't catch (the Medium
  finding called out "Mushroom Hot Cocoa" instead of "RYZE Mushroom Hot
  Cocoa" — same family of bug; this worktree generalizes the check).

All three are cheap deterministic checks driven by a canonical record.
No LLM tokens needed.

## Files to create

### `src/cross-page/content-rules.ts`

Three exported functions, one file. Each takes a page URL plus page
content (text, HTML, or both) and returns Findings.

```typescript
import type { Finding, CanonicalRecord } from '../types/finding';

export async function checkCopyrightYear(
  url: string,
  pageText: string,
  canonical: CanonicalRecord,
  runId: string
): Promise<Finding[]>;

export async function checkBrandTerms(
  url: string,
  pageText: string,
  canonical: CanonicalRecord,
  runId: string
): Promise<Finding[]>;

export async function checkUrlTypos(
  url: string,
  pageHtml: string,  // need HTML to find <a href> values
  canonical: CanonicalRecord,
  runId: string
): Promise<Finding[]>;
```

### `checkCopyrightYear` behavior

- Regex-scan `pageText` for copyright statements:
  `/(?:©|copyright|&copy;)\s*(\d{4})(?:\s*[–-]\s*(\d{4}))?/gi`
- For each match, extract the most-recent year mentioned (the second year
  in a range, otherwise the first).
- If that year is not in `canonical.acceptableCopyrightYears`, emit:
  - `ruleId: 'content:outdated-copyright'`
  - `category: 'content'`
  - `severity: 'medium'`
  - `title: "Outdated copyright year: ©<year> on <url>"`
  - `description: "Copyright statement shows <year>; current acceptable years are <list>."`
  - `fingerprint: sha1('content:outdated-copyright:' + url + ':' + year)`
  - `meta: { detectedYear, acceptableYears }`
  - `confidence: 1.0`
  - `visualGate: pre-confirmed visible`

### `checkBrandTerms` behavior

- For each entry in `canonical.brandTerms`, scan `pageText` for near-matches.
- "Near-match" = Levenshtein distance 1-2 (and not exact). Use
  `fastest-levenshtein` npm package.
- Exclude exact case-insensitive matches (those are correct usage).
- Exclude legitimate variations listed in `canonical.brandVariants`.
- For each near-match, emit:
  - `ruleId: 'content:brand-term-typo'`
  - `category: 'content'`
  - `severity: 'medium'`
  - `title: "Possible brand-term typo: '<found>' vs '<canonical>'"`
  - `description`: cite the canonical, the variant found, the surrounding
    sentence (truncated to 80 chars on either side)
  - `fingerprint: sha1('content:brand-term-typo:' + url + ':' + foundTerm + ':' + canonicalTerm)`
  - `confidence: 0.6` (heuristic; many false positives are possible with
    edit-distance, so this is intentionally not 1.0)
  - `uncertain: true` if confidence < 0.7 (routes to uncertain tier)

Tune by maintaining a per-canonical-term minimum length (don't fire
edit-distance-2 on a 4-letter term; too many false positives). Default:
only check terms 8+ characters long for distance 2; 6+ for distance 1.

### `checkUrlTypos` behavior

- Parse `pageHtml` and extract all `<a href>` values (relative URLs only;
  external links are out of scope).
- For each path segment in each href, check against `canonical.brandTerms`
  with the same near-match logic as above.
- Example: `/pages/brandambassdor` → segment `brandambassdor` → near-match
  to `brandambassador` (distance 1) → fire.
- Emit:
  - `ruleId: 'content:url-typo'`
  - `category: 'content'`
  - `severity: 'high'` (a typo'd URL means the right URL might also exist
    and get duplicate-page issues, or worse, the typo URL is the only
    public one)
  - `title: "URL typo: <bad path> (close to '<canonical>')"`
  - `description`: the URL, the page where it was linked from, the
    canonical term
  - `fingerprint: sha1('content:url-typo:' + badPath + ':' + canonical)`
  - `confidence: 0.85` (URLs are higher confidence than free text; if a
    URL contains a near-miss of a brand term, it's almost always a typo)
  - `meta: { badPath, canonicalTerm, foundOnPage: url }`

Deduplicate so the same typo URL discovered on multiple pages produces
ONE finding with the first source page recorded and a `meta.alsoFoundOn`
list. Use the fingerprint to detect duplicates within the run.

## Dependencies

```json
{
  "dependencies": {
    "fastest-levenshtein": "^1.0.16"
  }
}
```

## Tests

`tests/cross-page/content-rules.test.ts`:

Copyright:
- positive: text "© 2024 RYZE" with acceptable [2025, 2026] → 1 finding
- positive: text "© 2025-2024" (weird) → uses most-recent year, 2025 → no finding
- negative: text "© 2026 RYZE" → 0 findings
- edge: no copyright text → 0 findings
- multiple copyright lines on one page → deduplicated to 1 finding

Brand terms:
- positive: "brandambassdor" in text, canonical "brandambassador" → 1 finding
- negative: "brandambassador" exact match → 0 findings
- negative: "Ryze" when "Ryze" is in brandVariants → 0 findings
- edge: 4-letter term "Ryze" with distance-2 match doesn't fire (too short)

URL typos:
- positive: `<a href="/pages/brandambassdor">` → 1 finding
- negative: `<a href="/pages/brandambassador">` → 0 findings
- positive: same bad URL found on 2 pages → 1 finding with
  `meta.alsoFoundOn` populated
- edge: external `<a href="https://example.com">` is ignored

## Success criteria

- `npm run test:unit` passes.
- Dry-run against known-bad pages produces:
  - At least one `content:url-typo` finding for `/pages/brandambassdor`
  - At least one `content:outdated-copyright` finding for the Spanish
    Replo pages mentioned in the bug report
- No changes outside `src/cross-page/`, `tests/cross-page/`,
  `config/canonical-record.json` (only to seed values during testing).

## Reference

- `src/types/finding.ts`
- `docs/check-author-guide.md`
- `config/canonical-record.json` from preflight
- `fastest-levenshtein` docs

## Boundaries — do not

- Modify check modules
- Modify orchestrate
- Spell-check arbitrary words; this is a *dictionary* check (typo of a
  known canonical term), not a free-form English spell-checker. A general
  spell-checker would produce too much noise.
- Call any LLM; this entire worktree is deterministic.

## PR convention

Title: `worktree-D: content rules (copyright, brand terms, URL typos)`

Description must list:
- Files added
- Dependency added
- Tests added
- Dry-run findings (paste 3-5)
- Any tuning of distance thresholds or minimum lengths beyond the
  brief's defaults

## Open assumptions to verify

1. Whether the canonical record loader exists. If not, write a small
   `src/config/canonical.ts` that reads `config/canonical-record.json`
   and validates against the `CanonicalRecord` interface.
2. What HTML source is available when this check runs. Assumed:
   serialized HTML from Playwright `page.content()`. Confirm in
   `src/checks/` patterns.
