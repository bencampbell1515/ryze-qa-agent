---
description: Run the complete full-audit pipeline (clean → crawl → Playwright ‖ personas → orchestrate) for both RYZE sites
---

Read CLAUDE.md to refresh constraints, then run:

```bash
npm run full-audit
```

This single command runs the full pipeline in order:
1. `clean` — clears bugs.jsonl, discoveries.jsonl, data/tmp, and validated-bugs.jsonl
2. `test:crawl` — discovers URLs from both sites (~245 URLs), writes output/url-list.json
3. `test:audit` ‖ `discover:agentic` — Playwright (3 viewports) and 4 agentic personas run in parallel via scripts/run-audit.ts
4. `orchestrate` — validate + semantic-dedup + score + summaries → HTML + PDF report

Run it in the background (takes **1.5–2.5h** with current config). Log to `/tmp/qa-audit.log`:

```bash
npm run full-audit > /tmp/qa-audit.log 2>&1
```

**What Playwright checks (active):**
- `network:4xx` — broken links and missing assets (400/404/4xx grouped by path)
- `seo:*` — missing meta descriptions, missing canonical, missing JSON-LD
- `revenue:*` — ATC flow, price display, checkout handoff
- Navigation failures and Cloudflare challenge page detection (auto-skipped)

**What is NOT checked (intentionally disabled):**
- `axe:*` / WCAG / ADA — all a11y checks removed (near-100% noise)
- `content:typo` — cspell removed (near-100% false positives on product/ingredient names)

**Personas (4 × Haiku):**
- revenue-hawk, skeptical-first-timer, brand-purist, forensic-technician
- Run 2 concurrent; each works in batches of 7 URLs
- Screenshot images are pruned from context after 2 turns to prevent 200k token overflow
- Non-fatal — persona failure does not abort Playwright

**Monitor during run:**
```bash
tail -f /tmp/qa-audit.log
```

Check for:
- `⚠️ [persona] failed` — note which persona and reason (screenshot timeout vs context overflow)
- `[playwright] X passed` — confirms Playwright finished cleanly
- `▶ Running validate...` — orchestrate started; validate step takes ~10 min
- `✅ Scored N findings` — dedup complete

**When complete, report:**
- Total URLs crawled
- Unique bugs found (Critical / High / Medium / Low breakdown)
- Any persona failures and reason
- Path to the generated HTML + PDF report
- Flag any `⚠️` errors seen in the log
