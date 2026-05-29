# Report

Reads `data/bugs.jsonl`, deduplicates, and writes `output/audit-report-<date>.html` + `output/audit-report-<date>.pdf`.

## Key files

| File | Purpose |
|------|---------|
| ~~docx-builder.ts~~ | **Retired** — previously built Word document; replaced by html-builder + pdf-exporter |
| html-builder.ts | Builds HTML report from deduped bug list. Accepts optional `gateInfo` param to render the "visual gate degraded" banner when the LLM gate had failures. **Worktree L (2026-05-29):** also accepts optional `tiers?: ReportTiers` — when present, renders three labeled sections (Main / Needs review / Hygiene), per-card confidence badges (green ≥0.8 / yellow 0.5–0.79 / red <0.5), and collapsed two-judge reasoning on uncertain cards. When `tiers` is **omitted, output is byte-identical to legacy** (`audit-only` path unaffected). The `suppressed` pile is intentionally NOT rendered — three tiers is the design. |
| screenshot-cropper.ts | Resolves which screenshot to embed per bug. **Worktree H (2026-05-29):** prefers tight element crops written to `output/crops/<runId>/<findingId>.png` by `src/crops/captureCrop` (via `tests/checks/*` `emitBug` integration), falls back to the Tier-2 hero slice, then to a full-page shot. `getCroppedScreenshotForFinding()` is the Finding-aware sibling used by L's three-tier renderer. |
| finding-reader.ts | **Worktree L (2026-05-29).** `readReportTiers()` reads `findings.jsonl` / `uncertain-findings.jsonl` / `suppressed-findings.jsonl` / `hygiene.jsonl`. Missing files → empty arrays, malformed lines skipped + logged to stderr, never throws. Called from `scripts/report.ts` and `scripts/orchestrate.ts` and passed to `buildHtml` as the `tiers` param. |
| suppressed-builder.ts | Renders `output/audit-report-<date>-suppressed.html` from records the visual gate judged `not-visible`. Same `escapeHtml`/`urlListHtml` helpers, simpler layout (no severity tabs/categories) — meant for spot-checking, not stakeholders. |
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
- **LLM-generated summaries and categories are NOT persisted to disk** — `orchestrate.ts` writes `data/scored-bugs.json` BEFORE calling `generateSummaries()` and `assignCategories()`. The decorated `withCategories` object is only held in memory and passed to `buildHtml`. Consequence: you cannot regenerate the HTML report from `scored-bugs.json` without re-spending the LLM budget on summaries+categories. For retroactive edits (e.g. removing a specific finding from an existing report), surgically edit the HTML instead of regenerating. To match HTML cards back to entries in `scored-bugs.json`: sort `scored-bugs.json` by `(SEVERITY_ORDER[severity], -score)` (stable sort), and card N in the severity view corresponds to `sortedBugs[N]`. The category view groups by `bug.category` then sorts within group by `(severity, -score)`. Be aware of URL-list collisions — two distinct findings can share the same affected-pages list (e.g. a Liquid error and a missing image both hitting the same product trio), so match by `(summary text, sorted-url-list)` together, not URL list alone. After editing the HTML, regenerate the PDF with `pdf-exporter.ts` directly — do not re-run `report.ts` (it rebuilds from `bugs.jsonl` and loses LLM summaries).
