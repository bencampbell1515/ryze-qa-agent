# Scripts

Entry points for the QA pipeline — `tsx` scripts that orchestrate crawl, audit, report, and discovery phases.

## Key files

| File | Purpose |
|------|---------|
| run-audit.ts | Parallel launcher: spawns `test:audit` + `discover:agentic` simultaneously, streams labeled output, forwards SIGINT/SIGTERM |
| crawl.ts | Fetches sitemap via curl, writes `output/url-list.json` |
| report.ts | Reads bugs.jsonl → noise filter → dedup → html-builder → pdf-exporter |
| orchestrate.ts | Full pipeline: audit → agentic personas → report (has own `NOISE_RULE_IDS` — must mirror `report.ts`) |
| reverify.ts | Re-checks open bugs against live pages; captures element screenshots for HTML report. |
| summarise.ts | LLM summaries per finding (Sonnet for critical/high/medium, Haiku for low) |
| categorise.ts | Single Haiku call clusters all findings into category labels |
| discover-agentic.ts | Runs 4 agentic personas (2 concurrent) via Claude tool_use |
| validate.ts | Validates bugs.jsonl entries against live pages |
| dismiss.ts | Marks findings as dismissed; excluded from future reports |
| probe-image-404.ts | Ad-hoc debug script: load any URL, capture CDP `Network.requestWillBeSent` initiator for the broken Replo `cdn/shop/files/?v=…` pattern, walk the live DOM to find the offending element, and run `runImageCheck` against the page. Usage: `npx tsx scripts/probe-image-404.ts [url]`. |

## Known noise — rule IDs, hosts, and URL patterns

### Rule IDs filtered entirely
**Same list must exist in BOTH `report.ts` AND `orchestrate.ts`** — they are separate code paths:

- `network:nav-failed` — CDN redirect blocks (formerly Edgemesh, now Cloudflare)
- `network:429` — rate-limiting our bot
- `network:503` — Shopify bot-defense on `/cart/update.js`; real users unaffected
- `revenue:no-atc` — ATC button is JS-rendered (Recharge widget), loads after wait window
- `js:pageerror` — ALL JS exceptions in headless Chrome are bot artifacts (Popper.js, analytics, GTM-blocked jQuery)
- `console:error` — same reasoning; every instance is third-party analytics/widget noise
- `network:failed` — CDN bot-detection drops (ERR_FAILED, ERR_CONNECTION_CLOSED); real missing resources return `network:404`

### Noise hosts (full list in `report.ts` `NOISE_HOSTS`)
- `applovin.com`, `sentry.io`, `postscript.io`, `clarity.ms`, `mountain.com`
- `otlp-http-production.shopifysvc.com` — Shopify internal OTEL telemetry, blocked for bots
- `id.ryzesuperfoods.com` — Ryze identity/SSO service, blocked for bots
- `api.rechargeapps.com` — returns 403 (bot has no auth token; authenticated users fine)

### Noise 404 URL patterns (filtered in `report.ts` `NOISE_404_URL_PATTERNS`)
- `/em-prerender`, `/em-cgi/` — Edgemesh instrumentation endpoints (harmless leftovers)
- `cdn.shopify.com/.../t/NNN/` where NNN ≠ `2676` — stale references from inactive themes
- `/Liquid(\s|%20|\+)error/i` — Liquid template errors rendered into `href` attributes (e.g. `/products/Liquid%20error%20(sections/callout-card%20line%2089)...`). Known theme bugs in `sections/callout-card.liquid:89`, `sections/callout-card-v2.liquid:147`, `sections/ryze-hero-product-bundle.liquid:249` — tracked separately, suppressed at network-check time so they don't dominate the 404 report.

### Message-level filtering
- `console:error` and `js:pageerror` suppressed by blanket `NOISE_RULE_IDS` (not per-message regex)
- Shopify `/t?event=` analytics 404 filtered via `NOISE_404_URL_PATTERNS` in `report.ts`

## Gotchas

- **`orchestrate.ts` NOISE_RULE_IDS must mirror `report.ts`** — `orchestrate.ts` calls `buildHtml` directly, bypassing `report.ts`. If you add or remove a rule ID in one, do the same in the other. A shared `src/noise-config.ts` would be the right fix but isn't implemented yet.
- **`reverify.ts` rule prefix is `axe:` not `a11y:`** — the axe check module emits `ruleId: \`axe:${violation.id}\``. `reverify.ts` now uses the correct `axe:` prefix when re-checking WCAG violations.
- **HTML report `href` URLs need scheme guard, not just escaping** — `escapeHtml()` does not block `javascript:` URIs. `safeSrc()` in `html-builder.ts` rejects anything not matching `https?://`. Do not remove this guard.
- **Category clustering `max_tokens` must be ≥ 4096** — `categorise.ts` sends all findings in one Haiku call. At 1500 tokens the response truncates at ~115 entries, `JSON.parse` throws, and all bugs silently fall back to rule-prefix categories.
- **Multi-run warning fires on long single runs** — `report.ts` warns when `bugs.jsonl` timestamps span >2h. A normal 3–5 hour single audit triggers it; safe to ignore after `npm run clean`.
- **`validated: true` default when API key missing (VALID-001, FIXED)** — `orchestrate.ts` line ~169 now uses `validated: matchingBug?.validated ?? false`. A `[WARN]` message fires at startup when `ANTHROPIC_API_KEY` is absent. Bugs are no longer falsely marked as AI-confirmed when validation never ran.
- **LLM steps silently no-op without `ANTHROPIC_API_KEY`** — `validate.ts`, `discover-agentic.ts`, `summarise.ts`, `categorise.ts` all check for the key and exit early without error. `dotenv` is now installed; put `ANTHROPIC_API_KEY=sk-ant-...` in a `.env` file at project root and it will be loaded automatically.
