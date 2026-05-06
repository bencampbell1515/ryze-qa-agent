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
npm run test:audit        # run all checks → output/bugs.jsonl
npm run report            # dedupe + build HTML + PDF report
npm run full-audit        # clean + crawl + audit + report in sequence
npm run discover:agentic  # run 4 agentic personas (Claude tool_use) after audit
npm run orchestrate       # post-processing pipeline: validate + agentic personas + report (requires bugs.jsonl)
```

---

## Architecture

```
sitemap.xml + /debug/routes + /debug/split-tests → URL list → Playwright test suite (3 viewports) → bugs.jsonl
                                                                    ↓
                                                             fingerprint dedup
                                                                    ↓
                               agentic personas (Claude tool_use, 4 roles)
                                                                    ↓
                                                         HTML + PDF report builder
```

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

---

## Subsystem docs

- [tests/CLAUDE.md](tests/CLAUDE.md) — check modules, Playwright gotchas (toHaveScreenshot, ATC timing, lazy-load)
- [scripts/CLAUDE.md](scripts/CLAUDE.md) — pipeline scripts, noise filter config, report/orchestrate gotchas
- [src/report/CLAUDE.md](src/report/CLAUDE.md) — HTML/PDF report generation, dedup fingerprint details
- [docs/HISTORY.md](docs/HISTORY.md) — session fix history and key insights
