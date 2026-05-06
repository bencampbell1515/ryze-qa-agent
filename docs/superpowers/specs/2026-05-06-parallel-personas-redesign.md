# Parallel Personas + Pipeline Redesign — Spec

**Date:** 2026-05-06  
**Status:** Approved for implementation

---

## Goal

Implement the pipeline redesign described in `docs/audit-2026-05-06.md`:

1. Run agentic personas **in parallel with Playwright**, not after it
2. Use **per-persona model selection** (Sonnet for qualitative judgment, Haiku for structured verification)
3. **Remove reverify** from the pipeline (broken + redundant with live personas)
4. Add **LLM semantic dedup** for persona findings before the main dedup pass

---

## Current vs. Target Pipeline

**Current:**
```
clean → crawl → [playwright audit] → [validate + discover-agentic] → score → reverify → report
```

**Target:**
```
clean → crawl → [playwright audit ‖ discover-agentic] → validate → semantic-dedup → score → report
```

Key changes:
- `discover-agentic` moves from post-audit to alongside-audit
- `validate` runs alone (no longer racing discover-agentic — that already finished)
- `semantic-dedup` inserted after validate, before scoring, for discovery findings only
- `reverify` removed entirely

---

## Components

### 1. `scripts/run-audit.ts` (new)

Parallel launcher. Spawns `npm run test:audit` and `npm run discover:agentic` as child processes simultaneously. Streams stdout/stderr from each process with a label prefix (`[playwright]` / `[persona]`) so the combined log is readable. Waits for both to exit. If either exits with non-zero, logs the failure and exits with code 1 — aborting the pipeline before orchestrate runs.

This replaces the `test:audit` step in the `full-audit` npm script.

**Why a TS script instead of shell `&`:** shell background jobs don't propagate exit codes cleanly in npm scripts on macOS. A TS child_process spawn gives us labeled output and proper failure handling with ~30 lines of code.

### 2. `src/discovery/agent-loop.ts`

Add `model: string` to `SessionOptions`. Pass it through to `client.messages.create`. Default stays `'claude-sonnet-4-6'` for backwards compatibility.

### 3. `src/discovery/persona-runner.ts`

Add `PERSONA_MODEL` map:

| Persona | Model | Reason |
|---------|-------|--------|
| `brand-purist` | `claude-sonnet-4-6` | Qualitative judgment — tonal consistency, subtle copy drift |
| `skeptical-first-timer` | `claude-sonnet-4-6` | UX reasoning — trustworthiness, friction, CTA clarity |
| `revenue-hawk` | `claude-haiku-4-5-20251001` | Structured verification — ATC button present, price renders, subtotal math |
| `forensic-technician` | `claude-haiku-4-5-20251001` | Structured checks — dead links, 404s, JS errors, layout breakage |

Pass `model` through to `runSession` → `runSession` passes to `client.messages.create`.

### 4. `scripts/semantic-dedup.ts` (new)

Single-function module called from `orchestrate.ts`. Takes the array of `DiscoveryFinding[]` after validate loads them. Sends all findings to Haiku in one batch call with instructions to identify groups of findings that describe the same underlying defect. Returns deduplicated findings (one per group, preferring higher-confidence or more-detailed descriptions).

**Input:** Array of `DiscoveryFinding` objects  
**Output:** Deduplicated array of `DiscoveryFinding` objects  
**Model:** `claude-haiku-4-5-20251001`  
**Max cost per run:** ~$0.05 (20–50 findings × ~500 tokens each)  
**Fallback:** If the LLM call fails or API key absent, return input unchanged (log a warning)

**Prompt structure:**
- System: "You are a deduplication assistant. Identify groups of bug reports that describe the same underlying issue on the same or similar pages. Different phrasings of the same broken element = same bug. Different elements on the same page = different bugs."
- User: numbered list of findings with url + claim + ruleId
- Response format: JSON array of groups: `[{"keep": 0, "discard": [2, 5]}, ...]`

### 5. `scripts/orchestrate.ts`

Two changes:
- **Remove** `runScript('reverify')` (Step 7) and the "Read back scored-bugs.json" step after it
- **Add** `semanticDedup(discoveries)` call after discoveries are loaded and before they're merged with Playwright bugs

The `validate` and `discover-agentic` scripts currently run in parallel via `Promise.all`. With the new pipeline, `discover-agentic` finishes before orchestrate starts, so `Promise.all` becomes just `runScript('validate')`.

### 6. `package.json`

```json
"full-audit": "npm run clean && npm run test:crawl && npx tsx scripts/run-audit.ts && npm run orchestrate",
"audit-only": "npm run clean && npm run test:crawl && npm run test:audit && npm run report",
```

`audit-only` (no LLM steps) stays available for quick no-cost runs.

---

## Data Flow

```
url-list.json
     │
     ├──────────────────────────────────────────┐
     │                                          │
     ▼                                          ▼
playwright test:audit                    discover-agentic
(3 viewports, 245 URLs)                  (4 personas, own browser)
     │                                          │
     ▼                                          ▼
data/bugs.jsonl                     data/discoveries.jsonl
     │                                          │
     └──────────────────┬───────────────────────┘
                        │
                        ▼
                   orchestrate.ts
                        │
                  validate bugs.jsonl → validated-bugs.jsonl
                        │
                  semantic-dedup(discoveries) → deduped discoveries
                        │
                  merge + SHA1 dedup all bugs
                        │
                  score → scored-bugs.json
                        │
                  summaries + categories (LLM)
                        │
                  HTML + PDF report
```

---

## What Is NOT Changing

- `src/discovery/tools.ts` — tools are correct, no changes
- `src/discovery/persona-runner.ts` session/batch logic — sessions already carry `previousFindingsSummary` for cross-batch continuity
- `tests/checks/` — all Playwright check modules untouched
- `data/bugs.jsonl` format — unchanged
- `data/discoveries.jsonl` format — unchanged
- Max 2 concurrent browser contexts constraint — still respected (2 personas per batch in discover-agentic, separate from Playwright's 2 workers)

---

## Error Handling

- If `discover-agentic` fails mid-run: `run-audit.ts` exits non-zero, pipeline aborts before orchestrate. Partially written `discoveries.jsonl` is left as-is (orchestrate would use it if run manually).
- If Playwright fails: same — `run-audit.ts` exits non-zero.
- If semantic dedup LLM call fails: log warning, continue with undeduped discoveries (soft failure, never blocks the report).
- If both finish: `run-audit.ts` exits 0, `npm run orchestrate` proceeds.

---

## Cost Impact

Per run estimate with new design:

| Step | Model | Est. cost |
|------|-------|-----------|
| brand-purist + skeptical-first-timer (~60 batches) | Sonnet | ~$15–25 |
| revenue-hawk + forensic-technician (~60 batches) | Haiku | ~$3–5 |
| Validate (~200–500 bugs) | Sonnet | ~$3–8 |
| Semantic dedup (20–50 findings, 1 call) | Haiku | ~$0.05 |
| Summaries (critical/high) | Sonnet | ~$2 |
| Categories (single batch) | Haiku | ~$0.50 |
| **Total** | | **~$25–40/run** |

Removing Sonnet from revenue-hawk + forensic-technician saves ~$10–15/run vs. current all-Sonnet setup.
