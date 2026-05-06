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
npm run orchestrate       # full pipeline: audit + agentic personas + report
```

---

## Architecture

```
sitemap.xml → URL list → Playwright test suite (3 viewports) → bugs.jsonl
                                                                    ↓
                                                             fingerprint dedup
                                                                    ↓
                               agentic personas (Claude tool_use, 4 roles)
                                                                    ↓
                                                         HTML + PDF report builder
```

Key directories:
- `tests/` — Playwright specs + check modules (see [tests/CLAUDE.md](tests/CLAUDE.md))
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

`@playwright/test` · `@axe-core/playwright` · `linkinator` · `sharp` · `sharp-phash` · `cspell` · `docx` · `playwright-lighthouse` · `fast-xml-parser` · `robots-parser` · `p-limit`

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

- Klaviyo iframe, Gorgias chat widget, Meta Pixel, TikTok pixel, GTM
- `.myshopify.com` requests after checkout handoff
- Stock-out countdown timers (mask in visual diffs)
- **Rule IDs filtered entirely — same list must exist in BOTH `scripts/report.ts` AND `scripts/orchestrate.ts`** (they are separate code paths):
  - `network:nav-failed` — CDN redirect blocks (formerly Edgemesh, now Cloudflare); pages load fine for real users
  - `network:429` — rate-limiting our bot
  - `network:503` — Shopify bot-defense on `/cart/update.js`; real users unaffected
  - `revenue:no-atc` — ATC button is JS-rendered (Recharge widget), loads after our wait window
  - `js:pageerror` — ALL JS exceptions in headless Chrome are bot artifacts: Popper.js misfires without user interaction, analytics scripts blocked (Converge, Recharge), GTM-blocked jQuery; real UX breakage surfaces in axe/revenue/network checks instead
  - `console:error` — same reasoning as `js:pageerror`; every instance is third-party analytics/widget noise in bot context
  - `network:failed` — CDN bot-detection drops (ERR_FAILED, ERR_CONNECTION_CLOSED); real missing resources return HTTP 404 and are captured by `network:404`
- **Noise hosts** (full list in `scripts/report.ts`):
  - `applovin.com`, `sentry.io`, `postscript.io`, `clarity.ms`, `mountain.com`
  - `otlp-http-production.shopifysvc.com` — Shopify internal OTEL telemetry, blocked for bots
  - `id.ryzesuperfoods.com` — Ryze identity/SSO service, blocked for bots
  - `api.rechargeapps.com` — returns 403 because bot has no auth token; authenticated users are fine
- **Noise 404 URL patterns** (filtered in `scripts/report.ts`):
  - `/em-prerender`, `/em-cgi/` — Edgemesh instrumentation endpoints
  - `cdn.shopify.com/.../t/NNN/` where NNN ≠ `2676` — old/inactive theme assets (active theme is `t/2676`)
- **Message patterns filtered** — suppressed by blanket `NOISE_RULE_IDS` (`console:error`, `js:pageerror`), not by per-message regex. The Shopify `/t?event=` analytics 404 is filtered via `NOISE_404_URL_PATTERNS` in `scripts/report.ts`.

---

## Key gotchas

- **Cloudflare O2O is the bot bypass — not headless/headed mode** — The project uses Cloudflare Orange-to-Orange (O2O), which allows trusted Chrome instances through via `channel: 'chrome'` (system Chrome). Switching to "headed" mode does not change noise levels; O2O already handles bot detection. Do not conflate these two mechanisms.
- **Cloudflare blocks Node.js `fetch` for sitemaps** — TLS fingerprint discrimination (same mechanism as prior Edgemesh setup) causes fetch failure. Fix: shell out to `curl` via `execFile`. The `/em-cgi/` noise patterns can stay — they're harmless leftovers from the Edgemesh era.
- **shop.ryzesuperfoods.com sitemap blocked by Cloudflare** — only www.ryzesuperfoods.com's 228 URLs are in scope. shop.ryzesuperfoods.com has been unreachable via bot since Cloudflare migration; flag as ongoing advisory.
- **Desktop browser crash after ~4h** — Cloudflare closes the page mid-run on long sessions. `page.waitForTimeout()` throws on a closed page. Always chain `.catch(() => {})` on any `waitForTimeout` call inside the URL loop.
- **Active Shopify theme ID is `t/2676`** — CDN paths containing other theme IDs (e.g. `t/160`) are stale references from inactive themes; filter them as noise in `network:404`.
- `shop.ryzesuperfoods.com` is headless (likely Hydrogen) — missing JSON-LD/canonicals may be intentional; flag as advisories, not defects
- DOM price selectors (`[data-product-price]`, `.price__current`) are assumptions — verify against live DOM on first run
- **System sleep during long audits** — `caffeinate -dims` may be overridden by MDM. Workaround: keystroke jiggler (`osascript -e 'key code 63'` every 50s) resets MDM idle timer regardless of policy.
- **`network:failed` ≠ missing resource** — `network:failed` means CDN/bot-detection dropped the connection; `network:404` means the server confirmed the resource doesn't exist. Only `network:404` is actionable.
- **`js:pageerror` in headless is always noise** — Popper.js, analytics scripts, and jQuery (loaded via blocked GTM) all throw in bot context; never surfaces real user-facing breakage. Remove from report entirely.
- **Hidden modals render their broken images at 0×0** — a 404 inside a `display:none` modal has no visual impact; DevTools "scroll into view" does nothing because the element has no size. Use Playwright to force-open the modal and inspect.
- **Multi-run warning fires on long single runs** — `scripts/report.ts` warns when `bugs.jsonl` timestamps span >2h. A normal 3-viewport audit takes 3–5 hours, so this warning will fire even on a clean single run. Safe to ignore after `npm run clean`; only meaningful if you forgot to clean between runs.
- **Perceptual hash (dHash) pipeline is wired but dormant** — `BugInstance` has `dHash?`, `deduplicateBugs()` runs a fuzzy second pass via `shouldMerge()`, but no check module currently calls `computeHash()` to populate `dHash`. The fuzzy merge will have no effect until `visual.ts` or `a11y.ts` starts populating it.
- **`orchestrate.ts` NOISE_RULE_IDS must mirror `report.ts`** — orchestrate calls `buildHtml` directly without going through `report.ts`, so it has its own copy of the noise filter. If you add or remove a rule ID in one file, do the same in the other. A shared `src/noise-config.ts` would be the right fix but isn't implemented yet.
- **ATC selector must include "Get Started"** — Recharge renders "Get Started" (not "Add to Cart") on RYZE subscription products. The selector regex in `tests/checks/revenue.ts` is `/add to cart|subscribe|buy now|get started/i`. Don't remove `get started`.
- **`reverify.ts` rule prefix is `axe:` not `a11y:`** — the axe check module emits `ruleId: \`axe:${violation.id}\``. Any condition checking `ruleId.startsWith('a11y:')` will silently match nothing.
- **HTML report `href` URLs need scheme guard, not just escaping** — `escapeHtml()` does not block `javascript:` URIs. Use `safeSrc()` in `html-builder.ts` which rejects anything not matching `https?://`. Do not remove this guard.
- **Category clustering `max_tokens` must be ≥ 4096** — `scripts/categorise.ts` sends all findings in one Haiku call. At 1500 tokens the response is truncated at ~115 entries, `JSON.parse` throws, and all bugs silently fall back to rule-prefix categories.

---

## Subsystem docs

- [tests/CLAUDE.md](tests/CLAUDE.md) — check modules, Playwright gotchas (toHaveScreenshot, ATC timing, lazy-load)
- [src/report/CLAUDE.md](src/report/CLAUDE.md) — docx pitfalls, report generation, dedup fingerprint details
- [docs/HISTORY.md](docs/HISTORY.md) — session fix history and key insights
