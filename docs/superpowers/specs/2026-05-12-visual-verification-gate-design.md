# Visual Verification Gate

**Date:** 2026-05-12
**Status:** Approved for implementation

---

## Goal

Add a post-dedup stage that asks an LLM to look at each candidate bug and decide whether a typical shopper would actually notice it. Bugs the LLM judges as `not-visible` are dropped from the main report and routed to a separate suppressed-bugs report for spot-checking.

This is the first of four improvements identified in the 2026-05-12 session to address the root pattern behind every false positive: the bot reports DOM/network state without checking whether a user experiences it as broken.

---

## Problem

The audit's current report includes bugs that are real at the code level but invisible to shoppers:
- Broken images far below the fold (y=4000+)
- Empty `<img src="">` slots inside hidden modals
- `<picture>` srcset entries with broken URLs when the same `<picture>` has working `<source>` fallbacks
- `network:404` on tracking pixels and other invisible assets

Each false-positive class today is fixed by a hand-coded rule (viewport cutoff, NOISE_HOSTS list, empty-cart precondition). The visual gate generalizes that pattern: one LLM verdict per unique bug, applied across all visually-judgeable check categories.

---

## Architecture

A new orchestrate stage called `visual-gate` runs after deduplication and before the report build. It splits the deduplicated `BugRecord[]` into two lists — kept and suppressed — which feed two separate report builds.

```
data/bugs.jsonl
        │
        ▼
   deduplicateBugs()  →  BugRecord[] (~91 records per run)
        │
        ▼
   visual-gate (NEW)
        │   For each BugRecord whose ruleId is in the gated set:
        │     1. load elementShot + annotatedPageShot from output/
        │     2. call Sonnet 4.6 with bug context + 2 images
        │     3. record {verdict, verdictReason} on the BugRecord
        │
        ├──▶ verdict='not-visible'  →  SUPPRESSED list
        └──▶ verdict='visible' | 'uncertain' | gate-skipped  →  REPORT list
        │
        ▼
   buildReport(REPORT)         →  output/audit-report-<date>.html + .pdf
   buildSuppressedReport(SUP)  →  output/audit-report-<date>-suppressed.html
```

---

## Scope — which rule IDs go through the gate

**Gated** (LLM verdict required):
- `content:broken-image`
- `content:empty-image-src`
- `content:broken-picture-template`
- `network:404`
- `network:4xx` (after fingerprint normalization)
- `network:failed`
- `network:nav-failed`

**Always pass through** (verdict skipped, record kept as-is):
- Any ruleId not in the gated list above

The gated set is the complete filter. Records pass through if and only if their `ruleId` is not in the gated set. By construction this covers:
- `revenue:*` (functional defects — never gated)
- `seo:*` (not a visual judgment)
- Persona findings (distinct ruleIds like `revenue:countdown-stuck`, `revenue:discount-mismatch`, `brand:*` — none intersect the gated set)

Records that pass through unchanged have `verdict=undefined` and render in the main report exactly as they do today.

---

## LLM verdict

**Model:** `claude-sonnet-4-6` via `@anthropic-ai/sdk` (already in dependencies from persona pipeline).

**Input per record:**
- Text: ruleId, severity, message, affected URLs, selector, outerHTML snippet
- 2 images, both base64-encoded into the request:
  - Annotated full-page screenshot (`BugRecord.annotatedPageShot`)
  - Element close-up screenshot (`BugRecord.elementShot`)

**Output via tool_use** (forced structured response — model must call `submit_verdict`):

```ts
submit_verdict({
  verdict: 'visible' | 'uncertain' | 'not-visible',
  reason: string  // max ~300 chars, 1–2 sentences
})
```

**System prompt:**

```
You are reviewing a candidate bug from an automated QA audit of an e-commerce site.
Decide whether this bug is something a typical shopper would actually notice.

Verdicts:
- "visible"     — clearly noticeable: broken/missing visual content in or near the main
                  page content, broken layout, broken interaction, prominent error text.
                  Err toward "visible" for anything in the page's primary visible area.
- "not-visible" — real defect at the code level, but no shopper would see it. Examples:
                  empty <img> hidden inside a closed modal; broken background image far
                  below the fold; missing srcset entry where <picture> has working
                  fallback sources; 404 on a tracking pixel.
- "uncertain"   — can't tell from the screenshots. Default to this if ambiguous.
                  Uncertain findings STAY in the report.

Be conservative: only return "not-visible" if you can specifically point to why a
shopper wouldn't see it. When in doubt, return "uncertain".
```

**Concurrency:** `pLimit(8)`. Sonnet has lower TPM than Haiku; this keeps us under rate limits while finishing the gate in ~30–60s for ~91 records.

**Retry policy:** 2 retries per record with exponential backoff (1s, 3s) on transient failures (HTTP 429, 5xx, malformed tool_use response, network timeout).

---

## Failure handling

After all records are processed (including retries):

```
failedCount = records where all retries exhausted
totalGated  = records in the gated set

if totalGated > 0 AND failedCount / totalGated > 0.5:
  → throw — orchestrate aborts, no report built
  → user reruns `npm run report` to retry the gate (uses existing data/bugs.jsonl)

else if failedCount > 0:
  → degraded report: failed records get verdict='uncertain' and stay in the main report
  → banner inserted at top of main report:
    "⚠ Visual gate degraded: N of M records could not be validated"
```

The gate runs in the last few minutes of the pipeline, after the 4-hour crawl + Playwright + persona work has already produced `data/bugs.jsonl` and `data/discoveries.jsonl`. Hard-failing the gate does not lose the upstream work — a rerun is `npm run report`, not a full re-audit.

---

## Output

### Main report (`output/audit-report-<date>.html` + `.pdf`)

- All records with `verdict='visible'`, `verdict='uncertain'`, or `verdict=undefined`
- Banner at top when any record was degraded to `uncertain` due to gate failure

A subtle `[verified-visible]` badge next to the rule chip when `verdict='visible'` is **deferred** — not part of this spec's implementation plan. Easy to add later once the gate has been running and we know whether the signal is useful.

### Suppressed report (`output/audit-report-<date>-suppressed.html`)

- All records with `verdict='not-visible'`
- Same card layout as the main report, with one extra line per card: **"LLM reason: <verdictReason>"**
- Header text explains:
  > These are real DOM-level defects the visual gate suppressed because a shopper wouldn't notice them. Spot-check anything that looks wrong-suppressed and adjust the gate's prompt or scope if needed.
- No PDF export — this report is for internal QA, not formal sharing

---

## File layout

| File | Change |
|------|--------|
| `src/llm/visual-gate.ts` | NEW — `gateRecords(records: BugRecord[]): Promise<GateResult>` |
| `src/types.ts` | Add optional `verdict?: 'visible' \| 'uncertain' \| 'not-visible'` and `verdictReason?: string` to `BugRecord` |
| `scripts/orchestrate.ts` | Call `gateRecords()` after `deduplicateBugs()`; on hard-fail propagate the error; on success pass kept/suppressed to two report builds |
| `src/report/index.ts` (or current `buildReport` entry) | Accept optional `degradedCount` for the gate-failure banner. No changes to per-card rendering in this spec. |
| `src/report/suppressed.ts` | NEW — `buildSuppressedReport(records, dateStr)` reusing the card component from main report |
| `tests/llm/visual-gate.spec.ts` | NEW — unit test with mocked SDK; fixture set of ≥5 known cases covering each verdict |
| `CLAUDE.md` | Add a section explaining the gate, the two reports, and the `DISABLE_VISUAL_GATE` env knob |
| `package.json` | No new dependencies; `@anthropic-ai/sdk` already present |

**`GateResult` shape:**

```ts
type GateResult = {
  kept: BugRecord[];        // verdict='visible' | 'uncertain' | undefined
  suppressed: BugRecord[];  // verdict='not-visible'
  failedCount: number;
  totalGated: number;
};
```

---

## Disable knob

Env var `DISABLE_VISUAL_GATE=1` short-circuits `gateRecords()` to a no-op:
- All records are returned in `kept`, none in `suppressed`
- No LLM calls are made
- No banner is emitted

Useful for fast iteration during dev when changing report layout, or for cost-free CI runs.

---

## Testing

**Unit tests** (`tests/llm/visual-gate.spec.ts`):
- Mock `@anthropic-ai/sdk` with a fake `messages.create` that returns predetermined tool_use blocks
- Test cases:
  - Single record, verdict='visible' → kept
  - Single record, verdict='not-visible' → suppressed
  - Single record, verdict='uncertain' → kept
  - Record with ruleId outside gated set → no LLM call, kept
  - Retry path: first call throws 429, second succeeds → record gated normally
  - All retries exhausted → record counted as failed, verdict='uncertain'
  - >50% failed → throws (hard-fail)
  - `DISABLE_VISUAL_GATE=1` → all records kept, zero SDK calls

**Fixture corpus** (`tests/fixtures/visual-gate/`):
- 5–10 hand-picked `BugRecord` fixtures from the 2026-05-12 audit data, each with its element + page screenshot, covering:
  - A clearly visible broken hero image (should be `visible`)
  - A `network:404` on a tracking pixel (should be `not-visible`)
  - The dark-roast-espanol Replo `<picture>` template (borderline — should likely be `uncertain` or `not-visible`)
  - A `revenue:cart-subtotal-missing` record (must not be sent to the gate)
  - A persona finding (must not be sent to the gate)
- Used in a separate integration test (`tests/llm/visual-gate.integration.spec.ts`, gated on `ANTHROPIC_API_KEY` being set) that calls the real Sonnet API to verify the prompt actually produces correct verdicts on real data

---

## Non-goals (out of scope for this spec)

- Re-using verdicts across runs (caching). Each audit re-validates from scratch. Caching can be added later if cost or latency demands it.
- LLM-driven severity adjustment (e.g., demote High → Low based on verdict). The verdict is binary-relevant: keep or suppress.
- Visual-gating persona findings. Personas already include visual reasoning; double-validation is wasted cost.
- A UI for spot-checking suppressions (e.g., one-click "un-suppress this"). The suppressed.html report is the UI for now.

---

## Open questions / known limitations

- **Prompt iteration loop.** The rubric text in this spec is a first draft. Once the gate runs against the 2026-05-12 audit's 91 records, expect to iterate on the prompt 2–3 times based on observed mis-classifications. The fixture corpus tests are the regression net.
- **Image size to the API.** Element shots are typically ~50–200 KB; page shots can be 500 KB–2 MB. Sonnet supports images up to 8000×8000; no resizing should be needed, but if a page shot exceeds 5 MB it should be resized client-side before sending.
- **What "below the fold" means without scrolling context.** The full-page screenshot captures the entire scrolled page; the LLM sees the bug's position in the full layout. If the bug is at y=4000 on a 6000-tall page, the LLM should infer "buried" from the visual layout. If accuracy on this dimension is poor in practice, we can include the bug's `box.y` and `viewportHeight` in the prompt as a quantitative hint.
