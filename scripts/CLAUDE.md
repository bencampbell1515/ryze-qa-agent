# Scripts

Entry points for the QA pipeline — `tsx` scripts that orchestrate crawl, audit, report, and discovery phases.

## Key files

| File | Purpose |
|------|---------|
| run-audit.ts | Parallel launcher: spawns `test:audit` + `discover:agentic` simultaneously, streams labeled output, forwards SIGINT/SIGTERM |
| crawl.ts | Fetches sitemap via curl, writes `output/url-list.json` |
| report.ts | Reads bugs.jsonl → noise filter → dedup → html-builder → pdf-exporter |
| orchestrate.ts | Full pipeline: validate → semantic-dedup → merge+SHA1-dedup → **visual gate** → score → save-history → **dr-marcus-chen meta-analysis** (`runMetaAnalysis()`, writes `output/system-health-<date>.md`) → summarise → categorise → HTML/PDF. Has own `NOISE_RULE_IDS` — must mirror `report.ts` AND `validate.ts`. |
| reverify.ts | Re-checks open bugs against live pages; captures element screenshots for HTML report. |
| summarise.ts | LLM summaries per finding (Sonnet for critical/high/medium, Haiku for low) |
| categorise.ts | Single Haiku call clusters all findings into category labels |
| discover-agentic.ts | Runs **4 page-level personas** (revenue-hawk, skeptical-first-timer, brand-purist, forensic-technician) in 2 batches of 2 via Claude tool_use. **dr-marcus-chen is NOT here** — runs in `orchestrate.ts` as `runMetaAnalysis()`. |
| validate.ts | Validates bugs.jsonl entries against live pages. Has own `NOISE_RULE_IDS` — pre-filters before Haiku queue so a stale bugs.jsonl doesn't waste 20–40 min of validate time. Must mirror `report.ts` + `orchestrate.ts`. |
| dismiss.ts | Marks findings as dismissed; excluded from future reports |
| probe-image-404.ts | Ad-hoc debug script: load any URL, capture CDP `Network.requestWillBeSent` initiator for the broken Replo `cdn/shop/files/?v=…` pattern, walk the live DOM to find the offending element, and run `runImageCheck` against the page. Usage: `npx tsx scripts/probe-image-404.ts [url]`. |
| runner-daemon.ts | **Long-lived background process**, started by launchd (`com.ryzewith.qaagent.plist`). Listens to `runs` + `diffRequests` collections in Firestore. For each requested run: writes scan config to `data/.ryze-scan-config.json`, spawns `npm run full-audit` (detached process group), streams stdout/stderr + progress + URL counts to Firestore, uploads HTML/PDF/scored-bugs.json/suppressed.html to Storage on completion. For each diff request: downloads both bug JSONs, computes exact-match diff, then sends unmatched piles to Haiku for semantic matching. Cancellation: process-group SIGINT → SIGTERM (8s) → SIGKILL (15s) escalation. Orphan recovery on startup marks any `running` / `cancel-requested` docs as failed. **See root CLAUDE.md "Web UI + Runner daemon" for the full picture.** |
| start-daemon.sh | Wrapper script invoked by the launchd plist. Sources NVM (because launchd's PATH doesn't include it), `cd` to repo root, `exec npm run daemon`. Insulates the plist from node version changes. |

## Known noise — rule IDs, hosts, and URL patterns

### Rule IDs filtered entirely
**Same list must exist in `report.ts`, `orchestrate.ts`, AND `validate.ts`** — three separate code paths, all consuming raw bugs.jsonl:

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

- **`NOISE_RULE_IDS` must stay in lockstep across THREE files** — `report.ts`, `orchestrate.ts`, and `validate.ts` each maintain their own copy. They serve different concerns: report/orchestrate filter at render time, validate filters BEFORE the Haiku call (saves 20–40 min on stale bugs.jsonl). Add a rule ID to one without updating the others and it'll leak into the report. A shared `src/noise-config.ts` would be the right fix but isn't implemented yet.
- **`reverify.ts` rule prefix is `axe:` not `a11y:`** — the axe check module emits `ruleId: \`axe:${violation.id}\``. `reverify.ts` now uses the correct `axe:` prefix when re-checking WCAG violations.
- **HTML report `href` URLs need scheme guard, not just escaping** — `escapeHtml()` does not block `javascript:` URIs. `safeSrc()` in `html-builder.ts` rejects anything not matching `https?://`. Do not remove this guard.
- **Category clustering `max_tokens` must be ≥ 4096** — `categorise.ts` sends all findings in one Haiku call. At 1500 tokens the response truncates at ~115 entries, `JSON.parse` throws, and all bugs silently fall back to rule-prefix categories.
- **Multi-run warning fires on long single runs** — `report.ts` warns when `bugs.jsonl` timestamps span >2h. A normal 3–5 hour single audit triggers it; safe to ignore after `npm run clean`.
- **`validated: true` default when API key missing (VALID-001, FIXED)** — `orchestrate.ts` line ~169 now uses `validated: matchingBug?.validated ?? false`. A `[WARN]` message fires at startup when `ANTHROPIC_API_KEY` is absent. Bugs are no longer falsely marked as AI-confirmed when validation never ran.
- **LLM steps silently no-op without `ANTHROPIC_API_KEY`** — `validate.ts`, `discover-agentic.ts`, `summarise.ts`, `categorise.ts` all check for the key and exit early without error. `dotenv` is now installed; put `ANTHROPIC_API_KEY=sk-ant-...` in a `.env` file at project root and it will be loaded automatically.
- **Visual gate runs between dedup and scoring** — `gateRecords()` from `src/llm/visual-gate.ts` is called after `deduplicateBugs()` and produces `{ kept, suppressed, failedCount, totalGated }`. `recordsToScore = gateResult.kept` is what feeds the scoring loop and the main HTML report. `gateResult.suppressed` feeds `buildSuppressedHtml()` → `output/audit-report-<date>-suppressed.html`. `DISABLE_VISUAL_GATE=1` short-circuits it. See root CLAUDE.md "Visual verification gate" section for verdicts, scope, and tuning.
