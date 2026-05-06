# Report

Reads `data/bugs.jsonl`, deduplicates, and writes `output/audit-report-<date>.html` + `output/audit-report-<date>.pdf`.

## Key files

| File | Purpose |
|------|---------|
| ~~docx-builder.ts~~ | **Retired** — previously built Word document; replaced by html-builder + pdf-exporter |
| html-builder.ts | Builds HTML report from deduped bug list |
| pdf-exporter.ts | Exports HTML report to PDF via headless Chrome |
| gdocs-uploader.ts | Optional: uploads to Google Drive |
| ../../scripts/report.ts | Entry point — noise filter → dedup → html-builder → pdf-exporter |

## Patterns

- `data/bugs.jsonl` is append-only; multiple audit runs accumulate; dedup handles duplicates
- `isNoise()` in `scripts/report.ts` runs before dedup — filters ~40% of raw instances
- **Current noise rule IDs (entire categories filtered):** `network:nav-failed`, `network:429`, `revenue:no-atc`, `js:pageerror`, `console:error`, `network:failed`
- Dedup fingerprint: `SHA1(ruleId + normalizedMessage + sectionAnchor + dHash)` — see `src/dedupe/fingerprint.ts`; `dHash` is the full 64-char binary string from `sharp-phash`, not a hex slice
- `normalizeMessage()` strips: axe element-specific details (everything after `— Fix any/all/one of the following:`), full HTTP URLs, floats, hex colors, dates, ID suffixes — this groups same-rule violations across all pages into one record
- Stripping full URLs is critical for `seo:missing-meta-description` (each message embeds its page URL); for `network:404` only the scheme+host is stripped so each broken resource path remains a distinct fingerprint
- Screenshots embedded via `<img>` tags in `html-builder.ts` — looks up `output/screenshots/<url-slug>-<viewport>.png`; gracefully skips if file doesn't exist (populated on next `npm run test:audit`)

## Gotchas

- **Never put large JSON blobs in a `Paragraph`** — creates a multi-MB XML text node that crashes Word/Google Docs
- **Table cells require explicit `WidthType.DXA` column widths** — omitting causes text to render vertically
- **Use paragraph-based layout** (headings + indented text runs) for bug listings — simpler and guaranteed to render correctly
- **`dHash` field exists on `BugInstance` but is never populated** — `sectionAnchor` now flows through `a11y.ts` (via `getSectionAnchor()`) and the fuzzy Hamming second pass in `deduplicateBugs()` is wired, but no check module ever calls `computeHash()` to set `dHash`. The fuzzy merge silently no-ops for every record. When adding visual-hash support, note that `sharp-phash` returns a 64-char **binary** string (`'0'`/`'1'` chars), not hex — do not slice it.
- **`instanceCount` is inflated by axe node counts and multi-run accumulation** — one axe violation on 224 buttons = 224 instances on a single pass; bugs.jsonl is append-only so repeated runs inflate it further. Use `npm run clean` before each audit. Do not present `instanceCount` as a count of distinct broken pages.
- **Multi-run accumulation warning fires false positives on long single runs** — `scripts/report.ts` warns when timestamps in bugs.jsonl span >2h. A single 3-hour audit triggers it; it is informational only and does not affect dedup correctness.
