# Ryze QA Agent

Automated bug-hunting agent that crawls **ryzesuperfoods.com** and **shop.ryzesuperfoods.com**, deduplicates bugs by Shopify section, and produces an HTML + PDF audit report.

**Target sites:** https://www.ryzesuperfoods.com · https://shop.ryzesuperfoods.com
**Output:** `output/audit-report-<date>.html` + `output/audit-report-<date>.pdf`

---

## Commands

```bash
npm install               # install deps (Node 20+, uses system Chrome — no browser download)
npm run clean             # clear data/bugs.jsonl and data/tmp before a fresh run
npm run test:crawl        # discover URLs → output/url-list.json
npm run test:audit        # run all checks → output/bugs.jsonl (Playwright only)
npm run report            # dedupe + build HTML + PDF report
npm run full-audit        # clean + crawl + [playwright ‖ personas] + orchestrate (full pipeline)
npm run audit-only        # clean + crawl + playwright + report (no LLM steps — fast, zero cost)
npm run discover:agentic  # run 4 agentic personas standalone (reads url-list.json)
npm run orchestrate       # post-processing: validate + semantic-dedup + score + summaries + report
```

**`full-audit` pipeline order:**
```
clean → test:crawl → run-audit.ts [test:audit ‖ discover:agentic] → orchestrate
```
Playwright and personas run in parallel via `scripts/run-audit.ts`. Both must finish before orchestrate starts.

---

## Architecture

```
sitemap.xml + /debug/routes + /debug/split-tests → URL list
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
         Playwright (3 viewports)        4 agentic personas
         → data/bugs.jsonl              → data/discoveries.jsonl
                    └───────────────┬───────────────┘
                                    ▼
                               orchestrate
                    validate bugs | semantic-dedup discoveries
                         merge + SHA1 dedup | score
                       summaries + categories | HTML + PDF
```

**Personas:** revenue-hawk (Haiku), forensic-technician (Haiku), brand-purist (Sonnet), skeptical-first-timer (Sonnet). Run 2 concurrent (browser limit). Each works in URL batches with a prior-findings summary for cross-batch continuity.

Key directories:
- `tests/` — Playwright specs + check modules (see [tests/CLAUDE.md](tests/CLAUDE.md))
- `scripts/` — pipeline entry points: crawl, report, orchestrate, reverify, summarise, categorise (see [scripts/CLAUDE.md](scripts/CLAUDE.md))
- `src/crawl/` — sitemap parser, linkinator runner
- `src/dedupe/` — fingerprint algorithm, selector-path walker, perceptual hash
- `src/annotate/` — sharp+SVG screenshot annotation
- `src/report/` — HTML builder, PDF exporter, screenshot cropper, styles (see [src/report/CLAUDE.md](src/report/CLAUDE.md))
- `src/discovery/` — agentic persona runner (tools.ts, agent-loop.ts, persona-runner.ts)
- `personas/` — persona markdown files (revenue-hawk, skeptical-first-timer, brand-purist, forensic-technician)
- `data/` — allowlist-domains.txt, brand-dictionary.txt, bugs.jsonl
- `output/` — screenshots, lighthouse reports, final .html + .pdf

---

## Constraints (non-negotiable)

- Max 2 concurrent browser contexts; 1.5s delay between page loads
- Honor `robots.txt` via `robots-parser` before every navigation
- User-agent: `RyzeQABot/0.1 (+pm@ryze.example)`
- NEVER submit payment, create accounts, or visit `/admin` / `/account/login`
- ATC test: click "Add to Cart", verify cart subtotal, confirm checkout button is enabled — then STOP. Do not click checkout.
- The two hosts do NOT share cart state — treat as independent sites

---

## Tech stack (don't substitute without asking)

`@playwright/test` · `@axe-core/playwright` · `linkinator` · `sharp` · `sharp-phash` · `cspell` · `docx` · `playwright-lighthouse` · `fast-xml-parser` · `robots-parser` · `p-limit` · `dotenv`

---

## Severity ladder

| Level | Examples |
|-------|---------|
| Critical | Broken ATC, checkout handoff fails, price=NaN/$0 |
| High | WCAG 2.1 A violations, broken internal links, broken hero images, missing canonical/JSON-LD on PDP, `network:404` on first-party assets |
| Medium | WCAG 2.1 AA violations, broken external links, layout shift >0.25, Lighthouse perf <50, missing meta descriptions |
| Low | Typos, contrast 4.0–4.4, broken third-party tracking pixel |

---

## Known noise — exclude from scans

Third-party widgets (Klaviyo, Gorgias, Meta Pixel, TikTok Pixel, GTM), `.myshopify.com` requests after checkout handoff, and stock-out countdown timers are excluded at check-time.

Full list of filtered rule IDs, noise hosts, and URL patterns lives in [scripts/CLAUDE.md](scripts/CLAUDE.md).

---

## Key gotchas

- **Cloudflare O2O is the bot bypass — not headless/headed mode** — The project uses Cloudflare Orange-to-Orange (O2O), which allows trusted Chrome instances through via `channel: 'chrome'` (system Chrome). Switching to "headed" mode does not change noise levels; O2O already handles bot detection. Do not conflate these two mechanisms.
- **Cloudflare blocks Node.js `fetch` for sitemaps** — TLS fingerprint discrimination causes fetch failure. Fix: shell out to `curl` via `execFile`. The `/em-cgi/` noise patterns can stay — they're harmless leftovers from the Edgemesh era.
- **shop.ryzesuperfoods.com has no sitemap** — `/sitemap.xml` returns a 404 redirect to `/fb?rz_track=error` (confirmed: not a Cloudflare block — Felipe verified no WAF rules exist). URL discovery for shop. is handled via two live debug endpoints fetched on every crawl: `/debug/routes` (routing table, ~19 enabled internal destinations) and `/debug/split-tests` (A/B test variants, active-only). Both live in `src/crawl/sitemap.ts`.
- **`npm run orchestrate` does not run crawl or audit** — it is a post-processing pipeline (validate → agentic personas → report) and requires `data/bugs.jsonl` to already exist. Full fresh scan sequence: `npm run test:crawl && npm run test:audit && npm run orchestrate`.
- **Desktop browser crash after ~4h** — Cloudflare closes the page mid-run on long sessions. `page.waitForTimeout()` throws on a closed page. Always chain `.catch(() => {})` on any `waitForTimeout` call inside the URL loop.
- **Active Shopify theme ID is `t/2676`** — CDN paths containing other theme IDs (e.g. `t/160`) are stale references from inactive themes; filter them as noise in `network:404`.
- `shop.ryzesuperfoods.com` is headless (likely Hydrogen) — missing JSON-LD/canonicals may be intentional; flag as advisories, not defects.
- DOM price selectors (`[data-product-price]`, `.price__current`) are assumptions — verify against live DOM on first run.
- **System sleep during long audits** — `caffeinate -dims` may be overridden by MDM. Workaround: keystroke jiggler (`osascript -e 'key code 63'` every 50s) resets MDM idle timer regardless of policy.
- **`network:failed` ≠ missing resource** — `network:failed` means CDN/bot-detection dropped the connection; `network:404` means the server confirmed the resource doesn't exist. Only `network:404` is actionable.
- **`js:pageerror` in headless is always noise** — Popper.js, analytics scripts, and jQuery (loaded via blocked GTM) all throw in bot context; never surfaces real user-facing breakage.
- **Hidden modals render their broken images at 0×0** — a 404 inside a `display:none` modal has no visual impact. Use Playwright to force-open the modal and inspect.
- **Perceptual hash (dHash) pipeline is wired but dormant** — `BugInstance` has `dHash?`, `deduplicateBugs()` runs a fuzzy second pass via `shouldMerge()`, but no check module currently calls `computeHash()` to populate `dHash`. The fuzzy merge will have no effect until `visual.ts` or `a11y.ts` starts populating it.
- **Okendo review widget excluded from axe (AXE-001, FIXED)** — `EXCLUDED_SELECTORS` in `tests/checks/a11y.ts` now includes `[data-okendo-initialized]`, `[class*="okeReviews"]`, and the third Okendo selector. False WCAG violations from the review widget are no longer reported.
- **No Spanish dictionary in cspell (SPELL-002, FIXED)** — `@cspell/dict-es-es` is now installed and loaded via `import` in `cspell.json`. Spanish-language content blocks and testimonials no longer generate false `content:typo` findings.
- **`validated: true` default when `ANTHROPIC_API_KEY` is absent (VALID-001, FIXED)** — The fallback in `orchestrate.ts` is now `?? false`, and a `[WARN]` message fires at startup when the key is absent. Bugs are no longer falsely marked as AI-validated when validation never ran. API key goes in `.env` at project root (dotenv is installed and wired into all LLM scripts).
- **`axe:moderate` violations map to medium severity (AXE-002, NOT A BUG)** — `moderate` impact falls through the `else` branch in `runA11yCheck` and is correctly mapped to `'medium'` severity. No `severityMap` entry is needed; the existing logic handles it. No fix required.
- **`reverify` is no longer part of the pipeline** — removed from `orchestrate.ts`. Live persona browsing during the audit replaces its purpose. The `reverify.ts` script still exists but is not called by any pipeline step.
- **`scripts/run-audit.ts` handles parallel launch + signal forwarding** — spawns `test:audit` and `discover:agentic` simultaneously. Handles Ctrl-C by forwarding SIGINT to both children (otherwise they run for the rest of the session orphaned). Persona failure is non-fatal; Playwright failure aborts the pipeline.
- **`personas/dr-marcus-chen.md` exists but is NOT wired in** — only four personas run: revenue-hawk, skeptical-first-timer, brand-purist, forensic-technician. Marcus Chen was written during an earlier design iteration and never added to `PERSONA_BATCHES` in `discover-agentic.ts`.
- **Semantic dedup runs on persona findings only, before merge** — `scripts/semantic-dedup.ts` sends all `discoveries.jsonl` entries to Haiku in one batch to collapse duplicates. SHA1 fingerprint dedup still runs after merge for Playwright findings. If the Haiku call fails, dedup is skipped silently (soft failure).
- **Soft hyphens (U+00AD) split words in cspell (SPELL-001, FIXED)** — HTML soft hyphens that render invisibly to users appear as word-boundary characters to cspell, causing false typo reports on valid words. `tests/checks/content.ts` now strips U+00AD before writing the tmpfile.

---

## Subsystem docs

- [tests/CLAUDE.md](tests/CLAUDE.md) — check modules, Playwright gotchas (toHaveScreenshot, ATC timing, lazy-load)
- [scripts/CLAUDE.md](scripts/CLAUDE.md) — pipeline scripts, noise filter config, report/orchestrate gotchas
- [src/report/CLAUDE.md](src/report/CLAUDE.md) — HTML/PDF report generation, dedup fingerprint details
- [docs/HISTORY.md](docs/HISTORY.md) — session fix history and key insights
