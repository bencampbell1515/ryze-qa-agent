# Orchestrated QA System Design
**Date:** 2026-05-05  
**Status:** Approved  
**Author:** Ben Campbell + Claude

---

## Overview

Extend the existing Ryze QA Agent with three new layers: a Claude API validation pass that verifies Playwright findings, a persona-driven discovery pass that finds human-observable bugs no automated tool would catch, and a unified scoring engine that ranks all findings by business impact. A private GitHub repository hosts the full system with a public-facing README.

The existing Playwright pipeline is the floor — new layers add value but never block delivery.

---

## Architecture

Five layers total. Layers 0–1 exist today; Layers 2–5 are new.

```
Layer 0 (existing): Playwright crawl
  sitemap → 229 URLs × 3 viewports → data/bugs.jsonl

Layer 1 (existing): Dedup + noise filter
  bugs.jsonl → fingerprinted records → noise suppression → .docx

Layer 2 (new): Validation pass
  bugs.jsonl → parallel Claude API agents (batched 20 at a time)
  Each finding → { validated: bool, confidence: 0–1 }
  Dismissed findings checked against data/dismissed.jsonl → suppressed
  Output: data/validated-bugs.jsonl

Layer 3 (new): Discovery pass
  4 persona agents run in parallel
  Input: url-list.json + output/screenshots/ + persona markdown file
  Evidence requirement enforced before findings reach scorer
  Output: data/discoveries.jsonl

Layer 4 (new): Scoring engine (pure TypeScript, no API)
  Merges validated-bugs.jsonl + discoveries.jsonl
  Consensus detection, scoring formula, severity floors applied
  Top 10 → lightweight Playwright re-verification pass
  Output: data/scored-bugs.json

Layer 5 (new): Enhanced report
  Executive summary + priority-ordered findings + validation status
  Output: output/audit-report-<date>.docx
```

### New file additions

```
personas/
  orchestrator.md
  revenue-hawk.md
  skeptical-first-timer.md
  brand-purist.md
  forensic-technician.md
  dr-marcus-chen.md

scripts/
  orchestrate.ts        ← main entry point for new pipeline
  validate.ts           ← validation pass
  discover.ts           ← discovery pass
  reverify.ts           ← Playwright re-check of top 10

src/scoring/
  scorer.ts             ← pure TypeScript scoring function

data/
  dismissed.jsonl       ← human-reviewed dismissals (gitignored from public view)
  report-history.jsonl  ← fingerprints from last 3 full-audit:v2 runs (for novelty bonus)

tests/
  fixtures/claude-responses/  ← pre-recorded agent outputs for fixture tests
  unit/scorer.test.ts
  unit/evidence-enforcer.test.ts
  smoke/orchestrate.test.ts
```

### New npm scripts

```
npm run orchestrate       # validate + discover + score + reverify + report
npm run full-audit:v2     # clean + crawl + playwright audit + orchestrate
npm run dismiss           # add a fingerprint to dismissed.jsonl
npm run test:unit         # scorer + evidence enforcer unit tests
npm run test:smoke        # orchestrator smoke test with fixtures
npm run lint:personas     # check all persona files have required sections
```

---

## Persona System

Every agent — including the orchestrator — is defined by a markdown file in `personas/`. At spawn time, `orchestrate.ts` reads the file and uses it as the Claude API system prompt. No persona logic lives in code. Personas can be tuned by editing markdown files without touching TypeScript.

### The six personas

| Persona | File | Mandate | Known bias |
|---|---|---|---|
| **The Orchestrator** | `orchestrator.md` | Scores findings, arbitrates conflicts, knows all other personas' biases | Undervalues brand issues (hard to quantify) |
| **Revenue Hawk** | `revenue-hawk.md` | ATC flow, pricing math, trust signals, subscribe-and-save accuracy, sale timer authenticity | Overstates urgency — severity discounted one level unless 2+ personas agree |
| **Skeptical First-Timer** | `skeptical-first-timer.md` | Mobile nav, social proof loading, claim consistency, purchase path dead ends | Underweights desktop-only issues |
| **Brand Purist** | `brand-purist.md` | Copy tone, product naming consistency, off-brand language, cross-sell logic | Overstates brand issues — capped at Medium unless Playwright confirms |
| **Forensic Technician** | `forensic-technician.md` | Schema/JSON-LD accuracy, 404 experience, analytics event firing, canonical correctness | Undervalues UX in favour of technical correctness |
| **Dr. Marcus Chen** | `dr-marcus-chen.md` | Evaluates the QA system itself — signal quality, feedback latency, what we're failing to measure. Reads dismissed.jsonl and flags if dismissed-to-found ratio is trending up (noisy) or down (improving). | Meta-level only, does not submit page-level bugs |

### Required persona file sections

Every file in `personas/` must contain these sections (enforced by `npm run lint:personas`):
- Background
- Mandate
- Blind Spots / Known Biases
- Evidence Requirements
- How to Frame Findings

### Structured evidence requirement

Every discovery finding must include all four fields or it is rejected before reaching the scorer:

```json
{
  "url": "https://...",
  "screenshot": "output/screenshots/...",
  "quotedElement": "<exact text or selector>",
  "claim": "what is wrong and why it matters"
}
```

---

## Discovery Agent Mandates (Layer 3)

### Revenue Hawk
- Product images match product name and description
- Bundle prices represent a real discount vs. buying items separately
- Sale timers reset on page refresh (evergreen = fake urgency = trust killer)
- Trust signals loading: star ratings, review counts, Trustpilot widget, "as seen on" logos
- Subscribe & Save toggle visible and savings math correct vs one-time price

### Skeptical First-Timer
- Mobile hamburger menu opens and all links resolve
- Social proof (reviews, UGC) actually loads on mobile
- Health claims consistent across PDP, collection page, and email opt-in copy
- No dead ends in the purchase path
- "As seen on" logos and press quotes load at all viewports

### Brand Purist
- Copy tone consistent across all page types
- Product naming consistent (e.g., "RYZE Mushroom Coffee" not "ryze coffee" not "mushroom coffee")
- No discount language that cheapens premium positioning
- Cross-sell / "you might also like" sections contain actually related products
- Off-brand phrases or competitor comparisons in copy

### Forensic Technician
- Product JSON-LD schema present and correct (name, price, availability, reviews)
- BreadcrumbList schema matches actual URL hierarchy
- 404 page offers helpful navigation, not a dead end
- Analytics events firing on ATC, page view, checkout initiation (inspectable via Playwright route interception on publicly observable network requests only — no authenticated Amplitude data required)
- Canonical tags point to the correct URL (not a redirect target)

---

## Scoring Engine

### Formula

```
score = (impact_weight × category_score)
      + page_importance
      + novelty_bonus
      + consensus_bonus
      − confidence_penalty
```

### Weights

| Dimension | Value |
|---|---|
| **impact_weight** — revenue | 4× |
| **impact_weight** — ux (a11y, broken links, layout) | 2× |
| **impact_weight** — ui (visual, typos, minor styling) | 1× |
| **impact_weight** — unknown | 0.5× |
| **page_importance** — home / PDP | +3 |
| **page_importance** — collection | +2 |
| **page_importance** — blog / policy | +1 |
| **novelty_bonus** — fingerprint unseen in last 3 runs (checked against data/report-history.jsonl) | +1 |
| **consensus_bonus** — 2+ sources agree on same URL+issue | ×1.5 |
| **confidence_penalty** | −(1 − confidence) |

### Severity floors by source

Severity floors control the *label* shown in the report. The score controls *rank order*. A Medium-labeled finding can outscore a High-labeled finding if it has stronger consensus and page importance.

| Source | Max severity label |
|---|---|
| Playwright deterministic | Any |
| Playwright + Claude validated | Any |
| Claude discovery, 2+ persona consensus | Up to High |
| Claude discovery, lone persona | Capped at Medium |

### Example scores

- Broken ATC on homepage (revenue, PDP, Playwright + Revenue Hawk, confidence 1.0):  
  `(4 × 1) + 3 + 1 + 1.5 − 0 = 9.5`

- Low-contrast text on blog post (UI, blog, lone Brand Purist, confidence 0.6):  
  `(1 × 1) + 1 + 0 + 0 − 0.4 = 1.6`

---

## False Positive Prevention

Seven mechanisms working in combination:

1. **Evidence requirement** — no URL + screenshot + quoted element + claim = rejected before scoring
2. **Severity floors** — lone Claude discovery findings capped at Medium
3. **Persona consensus** — 2+ personas required to reach High; ×1.5 score multiplier when met
4. **Orchestrator bias correction** — each persona's known over/under-reporting corrected at scoring time
5. **Dismissal memory** — `data/dismissed.jsonl` suppresses previously reviewed non-issues in all future runs
6. **Cross-viewport confirmation** — finding on only one viewport flagged "unconfirmed"; cannot reach Critical/High without human sign-off
7. **Re-verification pass** — top 10 findings re-checked by Playwright; marked confirmed / could-not-reproduce / inconclusive

---

## Data Flow

```
npm run full-audit:v2
│
├─ clean → crawl → playwright audit
│   └─ data/bugs.jsonl
│
└─ orchestrate
    │
    ├─ [PARALLEL]
    │   ├─ validate.ts → data/validated-bugs.jsonl
    │   └─ discover.ts → data/discoveries.jsonl
    │
    ├─ scorer.ts → data/scored-bugs.json
    │
    ├─ reverify.ts → top 10 marked confirmed/could-not-reproduce/inconclusive
    │
    └─ report.ts → output/audit-report-<date>.docx
```

---

## Error Handling + Resilience

The existing pipeline is the fallback for every failure mode.

| Failure | Behavior |
|---|---|
| Validation pass fails (API down) | Continue with raw bugs.jsonl; report header warns "Validation skipped — findings unvalidated" |
| Single validation batch fails | Batch findings default to validated:true, confidence:0.5 |
| One discovery persona crashes | Other three personas complete; report notes which persona failed |
| Discovery evidence rejected | Finding dropped before scorer; no malformed data downstream |
| Screenshot missing for a URL | That URL skipped for discovery (no hallucination without evidence) |
| Scoring engine fails | Impossible — pure TypeScript, no network dependency |
| Re-verify pass fails | Top 10 marked "unverified" in report; does not block report generation |
| All new layers fail | Falls back to existing report.ts behavior exactly |

---

## Dismissal Loop

After a human reviews the report, they can run:

```bash
npm run dismiss -- --fingerprint <id> --reason "by design"
```

This writes to `data/dismissed.jsonl`. Dr. Marcus Chen reads the dismissal log each run and includes in his system-level report:
- Dismissed-to-found ratio (trending up = noisy system, trending down = improving)
- Which check module generates the most dismissed findings (candidate for tuning)
- Novelty rate: what % of this run's findings are new vs. recurring

---

## Testing

### Unit tests
- `src/scoring/scorer.ts` — given BugInstance objects, assert correct scores, rank order, consensus detection, dismissal suppression
- Evidence enforcer — test all four rejection cases (missing URL, screenshot, quotedElement, claim)

### Fixture tests
- `tests/fixtures/claude-responses/` holds pre-recorded agent outputs for known bugs
- Tests assert validate.ts correctly parses agent output, applies confidence scores, handles malformed responses

### Smoke test
- End-to-end against 5-URL fixture (pre-saved screenshots + bugs.jsonl)
- Asserts orchestrate.ts completes, produces scored-bugs.json, top finding is revenue not UI

### Persona linter
- `npm run lint:personas` checks every file in `personas/` has: Background, Mandate, Blind Spots, Evidence Requirements, How to Frame Findings
- Fails CI if any section is missing

### CI additions
```
npm run tsc
npm run test:unit
npm run test:smoke
npm run lint:personas
```

---

## GitHub Repository

- **Visibility:** Private
- **Name:** `ryze-qa-agent`
- **README sections:**
  - What it does (plain English, no jargon)
  - Prerequisites (Node 20+, system Chrome, Anthropic API key)
  - Quick start (5 commands to first report)
  - Architecture diagram
  - Persona system explanation
  - Scoring model table
  - How to add a new persona
  - How to dismiss a false positive
  - Known gotchas (Edgemesh, Recharge timing, headless noise)
  - Contributing guide

---

## Delivery Order

Ship in three increments, each independently valuable:

1. **GitHub repo + README + scoring engine** — no API needed, report is better-ordered immediately
2. **Validation pass** — Playwright findings get confidence scores, false positive rate drops
3. **Discovery pass + persona files** — full system, human-observable bugs surfaced for the first time
