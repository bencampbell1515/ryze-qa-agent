## For worktree sessions

If you are running in a worktree and the task is "build worktree X", your
first step is to read `tasks/worktree-X-*.md` for the specific spec, then
`src/types/finding.ts` for the shared interface, then
`docs/check-author-guide.md` for conventions. Only then read the rest of
this file.

The worktree brief is authoritative. If something in this file or
`README.md` conflicts with the brief, the brief wins. Surface the conflict
on the PR.

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
npm run daemon            # runner daemon (Firestore listener) — usually auto-started by launchd
cd web && npm run dev     # web UI dev server (Next.js, http://localhost:3000)
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

**Personas:** **4 page-level personas** in `PERSONA_BATCHES` (`scripts/discover-agentic.ts`) — revenue-hawk, skeptical-first-timer, brand-purist, forensic-technician — all on `claude-haiku-4-5-20251001`. Run 2 concurrent max (browser limit). Each works in URL batches of 7 URLs (`SESSION_BUDGET = 7`) with a prior-findings summary for cross-batch continuity. **dr-marcus-chen** is intentionally NOT in PERSONA_BATCHES — his mandate is meta-level system health analysis (no browsing, no URL list), so he runs as `runMetaAnalysis()` inside `scripts/orchestrate.ts` after scoring. Output goes to `output/system-health-<date>.md` and is uploaded to Storage as the `systemHealthPath` artifact.

Key directories:
- `tests/` — Playwright specs + check modules (see [tests/CLAUDE.md](tests/CLAUDE.md))
- `scripts/` — pipeline entry points: crawl, report, orchestrate, reverify, summarise, categorise, runner-daemon (see [scripts/CLAUDE.md](scripts/CLAUDE.md))
- `src/crawl/` — sitemap parser, linkinator runner
- `src/dedupe/` — fingerprint algorithm, selector-path walker, perceptual hash
- `src/annotate/` — sharp+SVG screenshot annotation
- `src/report/` — HTML builder, PDF exporter, screenshot cropper, styles (see [src/report/CLAUDE.md](src/report/CLAUDE.md))
- `src/discovery/` — agentic persona runner (tools.ts, agent-loop.ts, persona-runner.ts)
- `personas/` — persona markdown files (revenue-hawk, skeptical-first-timer, brand-purist, forensic-technician, dr-marcus-chen)
- `data/` — allowlist-domains.txt, brand-dictionary.txt, bugs.jsonl
- `output/` — screenshots, lighthouse reports, final .html + .pdf
- `web/` — Firebase-hosted Next.js dashboard, deployed at `https://live-qa-agent.web.app` (see [web/CLAUDE.md](web/CLAUDE.md))
- `logs/` — runner daemon stdout/stderr (rotated by macOS, gitignored)

---

## Web UI + Runner daemon

The whole crawl pipeline can also be operated remotely from **https://live-qa-agent.web.app** — a Firebase-hosted Next.js dashboard that lets you arm scans, watch live progress, browse past reports, and diff two scans semantically.

```
Firebase project: live-qa-agent          (GCP + Firebase, same project)
Hosting URL:      https://live-qa-agent.web.app
Auth:             Google SSO, hard-restricted to @ryzewith.com
Service account:  ~/.config/ryze-qa/service-account.json  (chmod 600, gitignored)
```

**Architecture — hybrid runner pattern:** the UI lives in the cloud (Firebase Hosting + Firestore + Storage), the scan itself runs on this Mac (where Cloudflare O2O trusts our Chrome). The two halves communicate through Firestore:

```
Browser  ─── writes runs/{id} status=requested ──▶  Firestore
                                                       │
                                                       ▼  (onSnapshot)
                                          scripts/runner-daemon.ts (Mac)
                                                       │
                                                       ▼
                                          spawn `npm run full-audit`
                                          stream logs + progress → Firestore
                                          upload HTML/PDF/JSON → Storage
                                                       │
                                                       ▼
Browser  ◀── live updates via onSnapshot ────────  Firestore
```

**Daemon lifecycle:** the runner daemon (`scripts/runner-daemon.ts`) runs as a launchd LaunchAgent (`~/Library/LaunchAgents/com.ryzewith.qaagent.plist`), auto-starts at login, restarts on crash, and is one-at-a-time serial for scans. It also processes `diffRequests` (separate concurrent queue — diffs run alongside, not after, scans).

```bash
launchctl print  gui/$(id -u)/com.ryzewith.qaagent   # status
launchctl kickstart -k gui/$(id -u)/com.ryzewith.qaagent  # restart (after code edits)
tail -f logs/daemon.out.log                          # live log
launchctl bootout gui/$(id -u)/com.ryzewith.qaagent  # stop until next login
```

**Themes:** two full visual identities — `instrument` (default, dark/amber instrument-panel) and `atelier` (light cream/terracotta editorial newsroom with magazine-style run cards). Toggled in the header, persisted in `localStorage`.

**Diff view — two-pass:** picks two completed scans, fetches `scored-bugs.json` from Storage for each, computes exact fingerprint diff, then sends the unmatched piles to Haiku 4.5 in one batch to catch persona-worded duplicates. Results write back to a deterministic `diffRequests/{sortedRunIds.join("--")}` doc → automatic caching (re-picking the same pair re-subscribes, no recompute).

**Scan config (UI captures intent, plumbing partial):** the pre-flight modal collects site scope, check categories, persona toggles, viewports, max URLs, URL exclude patterns. Config is stored on the run doc and written by the daemon to `data/.ryze-scan-config.json` before spawning the audit. **Today, audit scripts do NOT yet read this file.** The UI fully captures the knobs but actual filtering is a follow-up — wire-up needs to happen per-script (`crawl.ts` for URL excludes/max-URLs, `run-audit.ts` for persona/viewport filtering, etc.).

See [web/CLAUDE.md](web/CLAUDE.md) for the dashboard component inventory and Atelier/Instrument theme conventions.

---

## Security posture (2026-05-27)

The dashboard is hard-restricted to verified `@ryzewith.com` Google accounts; the runner daemon is the only privileged code path. Layers, ordered by load-bearing:

**Auth & data tier (Firestore + Storage rules, deployed):**
- `isRyzeUser()` requires `email_verified == true` AND `firebase.sign_in_provider == 'google.com'` AND `email.matches('.*@ryzewith[.]com$')`. Email-only matching was the original gap — non-Google providers (anonymous, password, custom OIDC) could have forged the claim. Only Google is enabled in Firebase Auth console (verify periodically).
- `runs.create` requires `requestedBy == request.auth.token.email` (no impersonation), `runId.matches('^[A-Za-z0-9_-]{6,64}$')`, `note.size() < 500`, `scanConfig.size() < 50` (number of top-level keys).
- `runs.update` is limited to flipping `status → cancel-requested` AND `resource.data.requestedBy == auth.token.email` (users can only cancel their own runs).
- `diffRequests.create` validates `runIdA` / `runIdB` shape + pins `requestedBy`.
- Storage `/reports/{runId}/**` reads require the same `isRyzeUser()` + valid `runId` shape; writes are daemon-only via Admin SDK.

**App Check (Firebase + reCAPTCHA v3):**
- Site key `6LfcsP8sAAAAAMToipxWzRMS5MOVAXH2DNcix2f6` wired in `web/lib/firebase.ts`. Initialized in a `try/catch` so a CSP slip or ad blocker can't kill the entire SDK import — defense-in-depth, not the load-bearing gate.
- Enforcement currently **monitor-only** on Firestore + Storage. Soak metrics for 24h, then flip to enforce in the App Check console.

**Hosting headers (firebase.json):**
- Full CSP, HSTS (2 years, includeSubDomains, preload), X-Frame-Options DENY (defense-in-depth with `frame-ancestors 'none'`), X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy denying camera/mic/geo/payment/usb, COOP same-origin-allow-popups (popups MUST allow `postMessage` for Google Sign-In).

**Daemon input validation (`scripts/runner-daemon.ts`):**
- `isValidRunId()` regex `^[A-Za-z0-9_-]{6,64}$` is checked at every entry point (executeRun, executeDiff, onSnapshot push). Admin SDK bypasses rules — independent validation is mandatory.
- `validateScanConfig()` hand-rolled schema: drops unknown keys, max 4 levels of nesting, strings ≤ 500 chars, arrays ≤ 100 elements, blocks path-traversal-shaped object keys (`..`, `/`, `__`-prefix), and rejects any URL-shaped string not on `ALLOWED_CRAWL_HOSTS`. `SCAN_CONFIG_ALLOWED_KEYS` set MUST mirror `web/lib/scan-config.ts ScanConfig` type — adding a field in one without the other silently drops the value.
- `MAX_QUEUE_LENGTH = 10` cap (rejects excess runs as failed with explanatory message).
- `downloadBugsJson()` rejects any path not matching `^gs://<bucket>/reports/<runId>/scored-bugs\.json$` — even though the path comes from a daemon-written field, the regex backstops any future code that lets a user influence it.
- Shutdown ladder: SIGTERM → wait 8s → SIGKILL → wait 7s. Without escalation, wedged Chrome subtrees survive the daemon as zombies (see "27-day-old PID 90258" gotcha).

**Crawl allowlist (`src/crawl/sitemap.ts`):**
- `ALLOWED_HOSTS = {www.ryzesuperfoods.com, shop.ryzesuperfoods.com, ryzesuperfoods.com}`. `assertAllowedHost()` is called inside `curlFetch` before every network call.
- curl pinned to `--proto =https,http --proto-redir =https` (rejects file://, ftp://, gopher:// in redirect chains).

**GCP API key + filesystem hardening:**
- Firebase Web API key restricted to HTTP referrers (`*.live-qa-agent.web.app/*`) + 5 APIs (Identity Toolkit, Firestore, Storage, App Check, Installations).
- Service account JSON at `~/.config/ryze-qa/service-account.json` is chmod 600, gitignored.
- `scripts/start-daemon.sh` sets `umask 077` so future log rotations stay 600. Existing `logs/daemon.{out,err}.log` chmod'd to 600.
- `.env` gitignored, `.env.example` committed as the documented template.

**Accepted-risk advisories:**
- 8 transitive `uuid` advisories chain from `firebase-admin@13` → `@google-cloud/*` (GHSA-w5hq-g745-h8pq). Not exploitable: `@google-cloud` only calls `uuid.v4()` without the buffer arg the CVE requires. `npm audit fix --force` would downgrade to `firebase-admin@10` (catastrophic) or force `uuid@11` (ESM-only, would crash the daemon since `@google-cloud` still uses `require()`). Wait for Google to bump upstream; Dependabot will surface the moment they do.
- `postcss` CVE was cleared via `overrides` in `web/package.json` (`postcss: ^8.5.10`). Build-time only — not runtime-exploitable, but fix was cheap.

## Visual verification gate

After dedup and before scoring, every record whose ruleId is in the gated set
(`content:broken-image`, `content:empty-image-src`, `content:broken-picture-template`,
`network:404`, `network:4xx`, `network:failed`, `network:nav-failed`) is sent to
Sonnet 4.6 with its element + page screenshots. The LLM returns one of
`visible | uncertain | not-visible`:

- `visible` and `uncertain` → record stays in the main report
- `not-visible` → record is moved to `output/audit-report-<date>-suppressed.html`
  for spot-checking (real DOM defect, but no shopper would notice)

Records outside the gated set (revenue, seo, personas) pass through untouched.

**Disable knob:** `DISABLE_VISUAL_GATE=1 npm run orchestrate` skips the gate
entirely. Use during dev when iterating on report layout.

**Failure handling:** the gate retries each record twice with exponential backoff.
If >50% of LLM calls still fail, orchestrate aborts — rerun `npm run report` to
retry the gate without redoing the 4-hour audit. If fewer than 50% fail, the
report ships with a "gate degraded" banner at the top.

**No-API-key path is graceful, not a hard-fail.** When `ANTHROPIC_API_KEY` is
missing, the gate takes an early return: every in-scope record falls back to
`verdict: 'uncertain'` with `verdictReason: 'gate skipped: no ANTHROPIC_API_KEY'`,
`failedCount` is set to `inScope.length`, and the hard-fail >50% check is
bypassed. The report still builds and displays the degraded banner ("N of N
records could not be validated"). This diverges from the implementation plan,
which predicted no-key would abort — the graceful path is better UX (no
surprise abort on missing config) and the banner makes the degradation obvious.

**Real-world calibration (2026-05-12):** 32/62 records gated, 0 suppressed in
13.7s with `p-limit(8)` concurrency. The system prompt is deliberately
conservative — `Be conservative: only return "not-visible" if you can
specifically point to why a shopper wouldn't see it. When in doubt, return
"uncertain".` For more aggressive suppression, tune the prompt in
`src/llm/visual-gate.ts` and spot-check the suppressed report.

**Cost & latency:** ~32 in-scope records per run at Sonnet 4.6 ≈ $0.50,
~15s end-to-end.

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
| High | Broken internal links, broken hero images, missing canonical/JSON-LD on PDP, `network:4xx` on first-party assets, deceptive UI (fake timers, wrong discount math) |
| Medium | Broken external links, layout shift >0.25, Lighthouse perf <50, missing meta descriptions |
| Low | Broken third-party tracking pixel |

---

## Known noise — exclude from scans

Third-party widgets (Klaviyo, Gorgias, Meta Pixel, TikTok Pixel, GTM), `.myshopify.com` requests after checkout handoff, and stock-out countdown timers are excluded at check-time.

**Checks permanently disabled (too noisy, near-zero signal):**
- `runA11yCheck` — all `axe:*` rules (color contrast, image-alt, ARIA, scrollable-region, etc.) removed from `tests/crawl.spec.ts`. WCAG findings are no longer reported.
- `runContentCheck` — all `content:typo` rules removed. cspell was generating ~100% false positives by flagging fragments of compound words, product names, and ingredients.
- `attachConsoleListeners()` — call removed from `tests/crawl.spec.ts` (2026-05-27). Every `console:error` and `js:pageerror` captured in headless Chrome is third-party noise (Popper.js, analytics scripts, jQuery-via-blocked-GTM) and they accounted for ~83% of all bug entries (~13k of 15k per run). The function definition is preserved in `tests/checks/console.ts` for the day audits move out of headless+blocked-GTM context — until then, do NOT re-add the call. NOISE_RULE_IDS in `report.ts` / `orchestrate.ts` / `validate.ts` retain `js:pageerror` + `console:error` as defense-in-depth.

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
- **Perceptual hash (dHash) pipeline is wired but dormant** — `BugInstance` has `dHash?`, `deduplicateBugs()` runs a fuzzy second pass via `shouldMerge()`, but no check module currently calls `computeHash()` to populate `dHash`. The fuzzy merge will have no effect until `visual.ts` starts populating it.
- **`validated: true` default when `ANTHROPIC_API_KEY` is absent (VALID-001, FIXED)** — The fallback in `orchestrate.ts` is now `?? false`, and a `[WARN]` message fires at startup when the key is absent. Bugs are no longer falsely marked as AI-validated when validation never ran. API key goes in `.env` at project root (dotenv is installed and wired into all LLM scripts).
- **`reverify` is no longer part of the pipeline** — removed from `orchestrate.ts`. Live persona browsing during the audit replaces its purpose. The `reverify.ts` script still exists but is not called by any pipeline step.
- **`scripts/run-audit.ts` handles parallel launch + signal forwarding** — spawns `test:audit` and `discover:agentic` simultaneously. Handles Ctrl-C by forwarding SIGINT to both children (otherwise they run for the rest of the session orphaned). Persona failure is non-fatal; Playwright failure aborts the pipeline.
- **Semantic dedup runs on persona findings only, before merge** — `scripts/semantic-dedup.ts` sends all `discoveries.jsonl` entries to Haiku in one batch to collapse duplicates. SHA1 fingerprint dedup still runs after merge for Playwright findings. If the Haiku call fails, dedup is skipped silently (soft failure).
- **Sonnet personas burn ~$7 in under 2 minutes — do not use Sonnet for browsing personas** — observed empirically: `skeptical-first-timer` on Sonnet made 83 tool calls for 20 URLs. Full 4-persona × 245-URL run on Sonnet would cost ~$80–150. All 4 personas now use Haiku (~$3–10 estimated for full run). Never switch brand-purist or skeptical-first-timer back to Sonnet without a hard per-persona URL cap.
- **`SESSION_BUDGET` reduced from 20 → 7 for Haiku** — Haiku's structured output (JSON schema adherence) degrades as context fills within a session. 7 URLs/session keeps context lean; total URL coverage is unchanged across multiple sessions. If you raise this, watch for malformed `submit_finding` calls in later turns of each session.
- **Stuck-loop detection in `agent-loop.ts`** — after 3 consecutive identical tool calls (same tool name + same args), a LOOP GUARD reflection message is injected as a user turn and the count resets. The loop does NOT break — the agent is given a chance to recover. This prevents infinite loops on slow-loading elements or stubborn selectors.
- **Persona prompts hardened for Haiku quality** — all 4 persona files now include: numbered per-URL checklists (replacing abstract mandates), ARQ pre-answer scratchpad before `submit_finding` (What did I observe? / Is this a defect? / What severity?), domain exclusion lists (each persona states what it does NOT flag), explicit termination condition, and 2 inline few-shot examples. `brand-purist.md` includes injected brand facts (product name table, on/off-brand tone examples) since Haiku has no implicit brand knowledge.
- **Persona context overflow — five-layer fix (FIXED 2026-05-07)** — All 3 of 4 personas hit `400: prompt is too long: >200k tokens` in the 2026-05-07 run. Root causes: (1) `get_dom` returning up to 50k chars (~12.5k tokens) per call, never evicted; (2) `MAX_TOOL_CALLS = 150` allowed 150 full tool result payloads to accumulate; (3) screenshot pruning only handled images, not text results. Fixes: `pruneOldToolResults()` in `agent-loop.ts` evicts tool result text older than `MAX_TURNS_IN_CONTEXT = 12`; `get_dom` capped at 15,000 chars (was 50,000 — 15k covers `<head>` + first fold of body); `get_network_log` capped at 15 entries (was 50); `MAX_TOOL_CALLS` 150 → 50; proactive `response.usage.input_tokens > 150_000` check breaks the session loop cleanly before hitting the API limit. Worst-case calculated context: ~68k tokens (34% of 200k limit). `pruneOldScreenshotImages()` and `MAX_SUMMARY_CHARS = 4000` in `persona-runner.ts` remain as additional defence-in-depth.
- **Cloudflare challenge pages are now detected and skipped** — after `page.goto()`, if `body` contains "Your connection needs to be verified" or "Verifying you are human", the URL is skipped. Previously the bot ran all checks against the CF challenge page and took screenshots of it.
- **`network:4xx` fingerprint groups 400 and 404 on the same path** — `computeFingerprint()` normalizes any `network:4\d\d` ruleId to `network:4xx` before hashing, so a Liquid template error returning HTTP 400 on one page and HTTP 404 on another with the same broken path collapses into one bug record.
- **Liquid template errors are filtered at network-check time (NOISE-LIQUID, 2026-05-11)** — `tests/checks/network.ts` `NOISE_404_URL_PATTERNS` matches `/Liquid(\s|%20|\+)error/i`, so any URL that contains a Liquid error string (raw, %20-encoded, or +-encoded) never enters `bugs.jsonl`. The underlying theme bugs are still real and listed below; the filter just keeps them from dominating the 404 report on every run. If the underlying fix ships, remove the regex from `NOISE_404_URL_PATTERNS`.
- **Liquid template error locations (KNOWN REAL BUGS, filtered from reports)** — each renders the literal `Liquid error (...): invalid url input` string into an `href`, producing HTTP 400/404 when the browser requests the resulting `/products/Liquid%20error%20...` URL. Same root cause in all of them: missing nil guard before the `| url` filter. Theme files Ryze owns and can fix:
  - `sections/callout-card-v2.liquid` line 147 → 189 hits across 101 pages (bundles 404, individual products 400 — Mushroom Matcha, Mushroom Chicory variants)
  - `sections/callout-card.liquid` line 89 → 119 hits (discovered 2026-05-07)
  - `sections/ryze-hero-product-bundle.liquid` line 249 → 9 hits (discovered 2026-05-07)

  Replo-managed snippets (cannot fix directly — `snippets/reploChunk.<uuid>.<N>.liquid` files are generated by the Replo landing-page builder; fix must happen in the Replo source template, or contact Replo support). All occur on Spanish-language landing pages:
  - `snippets/reploChunk.7cf49500-f6d5-49c6-be94-5cae8fe994b5.7` line 129 → `/pages/mushroom-chicory-espanol`
  - `snippets/reploChunk.7cf49500-f6d5-49c6-be94-5cae8fe994b5.9` line 53 → `/pages/mushroom-chicory-espanol`
  - `snippets/reploChunk.3750d44f-fa8c-4ec4-871b-d09b59652ec2.8` line 196 → `/pages/mushroom-hot-cocoa-espanol`
  - `snippets/reploChunk.3750d44f-fa8c-4ec4-871b-d09b59652ec2.7` line 53 → `/pages/mushroom-hot-cocoa-espanol`
  - `snippets/reploChunk.b27325c3-3a80-4030-8dff-997b65a53881.7` line 128 → `/pages/mushroom-matcha-espanol`
  - `snippets/reploChunk.b27325c3-3a80-4030-8dff-997b65a53881.9` line 53 → `/pages/mushroom-matcha-espanol`
- **Validate step is the orchestrate bottleneck** — `scripts/validate.ts` calls Haiku once per raw bug entry at `pLimit(20)`. With 49k raw entries (pre a11y/content removal) this took ~60 min. After removing a11y + content checks, raw count should drop to ~5–10k, reducing validate to ~10 min.
- **Persona findings are higher-value than Playwright findings** — revenue-hawk found: evergreen countdown timer stuck at `00:00:00` across PDPs (deceptive urgency), discount math mismatches (e.g. "17% off $30" shows $25 not $24.90), cart upsell claiming "25% OFF" but showing 38% actual discount. These directly impact revenue and trust. Playwright's strength is systematic network/SEO coverage, not business logic.
- **`<img src="">` is silent in Chrome — no network request, no broken-image icon (2026-05-11)** — per HTML spec, an empty `src` is a no-op: the browser renders an empty box of the styled dimensions and never fires a network event. This means `network:404` cannot catch it; the bot's network listener has nothing to record. `tests/checks/image.ts` (rule IDs `content:empty-image-src`, `content:broken-image`, `content:broken-picture-template`) closes this gap by inspecting the live DOM for visible `<img>` with empty/null `src`, visible `<img>` with `naturalWidth === 0` after `complete`, and visible `<picture>` with the empty-filename Replo srcset pattern. Only flags visible elements (display/visibility/opacity + box ≥ 8×8) to keep hidden modal slots silent.
- **Replo signatures — how to recognize page-builder content (2026-05-11)** — Replo-rendered DOM has three tells: (1) `data-rid="<uuid>"` attribute on the wrapping element, (2) `r-XXXXX` hashed class names (styled-components/React style), (3) CSS custom properties named `--replo-attributes-product-productmetafields-custom-<field>` on `style` attributes. When the trailing field value is empty (`...:` with nothing after the colon), the metafield is missing — Replo still emits the template with an empty interpolation slot, producing broken `<picture>` srcsets like `cdn/shop/files/?v=NNN&width=NNN`. Known case: `/pages/mushroom-dark-roast-espanol` binds to the empty `custom.spanish_short_description_image` metafield. Fix is either populating the metafield or wrapping the Replo block in a conditional render.
- **Debugging "where does this URL come from?" requires Playwright + CDP, not curl (2026-05-11)** — when a 404 URL doesn't appear in the static HTML response, it's being constructed client-side. Use `scripts/probe-image-404.ts` as the template: launch Chrome via Playwright, attach CDP `Network.enable`, capture `Network.requestWillBeSent` initiator (gives type=parser/script/preload + URL + line + stack), then `page.evaluate` to walk the live DOM and find the matching element. Chrome's `parser` initiator can refer to JS-injected DOM (Replo, React hydration); the reported `lineNumber` may not exist in the curl'd HTML because it counts into the post-hydration serialized document.
- **Daemon cancellation requires process-group kill, not `child.kill('SIGINT')` (2026-05-27)** — `npm run full-audit` spawns `npx tsx scripts/run-audit.ts` which spawns Playwright workers + persona subprocesses + Chrome. Sending SIGINT only to the top npm process leaves the entire grandchild tree running (zombies for hours, locks on `data/bugs.jsonl`). Fix in `runner-daemon.ts`: spawn with `detached: true` (child becomes process-group leader), then signal `-pid` (negative = whole group): `process.kill(-child.pid, 'SIGINT')` → wait 8s → escalate to SIGTERM → wait 7s → SIGKILL. Verified: first SIGINT kills the tree cleanly in <10s normally.
- **Daemon orphan recovery runs on startup (2026-05-27)** — any `runs/{id}` doc still in `running` or `cancel-requested` state when the daemon boots is by definition stale (no daemon was alive to be processing it). The daemon now scans for these on connect and marks them `failed` with `errorMessage: "Daemon was not running when this run was active"`. Without this, a UI run would show "Cancelling…" forever after a daemon crash. Same query: `runs.where('status','in',['running','cancel-requested'])`.
- **NVM-installed node + launchd: needs a wrapper script (2026-05-27)** — launchd's `PATH` is sanitized and doesn't include `~/.nvm/...`. Solution: `scripts/start-daemon.sh` sources `$NVM_DIR/nvm.sh`, then `cd` to the repo and `exec npm run daemon`. The plist invokes `/bin/bash -l <wrapper>` rather than calling node/npm directly. Bonus: a node version bump doesn't require touching the plist.
- **Firebase Hosting deploy needs Storage provisioned via console first (2026-05-27)** — `firebase deploy --only storage` fails with `"Firebase Storage has not been set up on project '<id>'"` the first time. There's no CLI shortcut. Visit `https://console.firebase.google.com/project/<projectId>/storage`, click **Get started**, accept the rules prompt, and pick a region. After that, all future deploys (rules, hosting, etc.) work from the CLI without further clicks.
- **Diff doc IDs are deterministic by sorted run IDs → automatic caching (2026-05-27)** — `diffIdFor(a, b)` in `web/lib/diff.ts` sorts the two IDs and joins them with `--`. Same pair → same doc → no recompute (the daemon's listener fires only on newly-`requested` docs). Cost-saving by construction: re-opening the Diff page for the same pair is free even though the user wouldn't know it's cached.
- **Scan config UI is wired; audit scripts don't yet read it (2026-05-27)** — `data/.ryze-scan-config.json` is written by the daemon before spawning audit, but none of `crawl.ts` / `run-audit.ts` / persona scripts currently parse it. The UI captures intent (URL excludes, max URLs, persona toggles, etc.) and the config travels with each run for future use. Follow-up: wire `RYZE_SCAN_CONFIG_PATH` env var or direct `readFile` into each audit script. Prioritise `urlCount` cap and `urlExcludes` in `crawl.ts` first — biggest UX win.
- **`<img src="">` is silent in Chrome** (above, 2026-05-11) — closed by `tests/checks/image.ts`.
- **27-day-old zombie Chromium PID 90258 — reboot to clear** — STAT `UEs` (uninterruptible sleep, exit-requested, session leader). The kernel can't reap it because it's wedged on a file descriptor. Harmless leftover from an April 30 audit; only a reboot will collect it. Don't waste cycles trying `kill -9` — `sudo` doesn't help either.
- **Firebase App Check + reCAPTCHA v3 requires non-obvious CSP entries (2026-05-27)** — `apis.google.com` and `gstatic.com` are NOT sufficient. reCAPTCHA loads from `https://www.google.com/recaptcha/*` and uses `eval()` internally, so the working CSP also needs: `script-src` += `https://www.google.com` + `'unsafe-eval'`; `frame-src` += `https://www.google.com https://recaptcha.google.com`; `connect-src` += `https://content-firebaseappcheck.googleapis.com`. Symptom of getting this wrong: the sign-in button renders but is non-interactive — `initializeAppCheck` throws at module load, the entire firebase.ts export fails, React never hydrates. Wrap `initializeAppCheck` in `try/catch` so a future CSP regression can't take down the page entirely.
- **`SCAN_CONFIG_ALLOWED_KEYS` in `runner-daemon.ts` must mirror `web/lib/scan-config.ts ScanConfig`** — adding a field in either without updating the other silently drops the value before any audit script can read it. Easy to miss: validation drops unknown keys with a `console.warn`, not an error. Today's allowed set: `sites, checks, personas, viewports, maxUrls, maxDurationMin, concurrency, urlExcludes, presetName`.
- **`NOISE_RULE_IDS` now lives in THREE files, not two (2026-05-27)** — `validate.ts` joined `report.ts` + `orchestrate.ts` as a NOISE_RULE_IDS holder. Reason: `validate.ts` reads raw `bugs.jsonl` and sends every entry to Haiku at `pLimit(20)` *before* dedupe/report filtering would catch them. Pre-filtering noise here saves 20–40 min of wall-clock when a stale `bugs.jsonl` is reprocessed. All three sets MUST stay aligned. A shared `src/noise-config.ts` would be the right fix; not done yet.
- **Daemon progress percent bands (2026-05-27)** — `parseStep` in `runner-daemon.ts` maps audit phases to: queued=3, crawl=8, audit=20 (computeAuditPercent stretches 20→58), orchestrate=60 (occupies 60→100). The earlier scheme had orchestrate compressed into the last 10% of the bar even though it realistically takes 10–60 min. If you add a new pipeline phase, update both `parseStep` AND `computeAuditPercent`'s `AUDIT_CEILING` so they form a coherent sequence.
- **Per-persona URL counting needs a union, not a sum (2026-05-27)** — N personas each walk the same URL list, so `Σ(persona.visited)` can balloon to N × urlCount. The daemon parses `[persona-name] visited <url>` log lines (emitted from `persona-runner.ts`) and tracks a single `distinctUrlsVisited` Set across personas. If you change the log format in persona-runner, the daemon falls back to per-persona deltas capped at `urlCount` — but the union path is more accurate and should be preserved.
- **Persona completion needs an explicit `0 URLs remaining` log line (2026-05-27)** — `persona-runner.ts` breaks the session `while` loop *before* logging when `unvisited.length === 0`, so without an explicit final emit, the daemon's `current` counter stays pinned at the last session's leftover (typically SESSION_BUDGET=7 of 231). The runner emits `[persona] Session N+1: 0 URLs remaining` after the loop so the percent calc cleanly reaches 100% per persona. Don't remove this line.
- **`bugCount` in the run doc is live, not final, until orchestrate finishes (2026-05-27)** — `readLiveBugCount()` sums `bugs.jsonl` + `discoveries.jsonl` line counts during the run and falls through to `scored-bugs.json` at the end. Mid-run numbers are pre-dedup and pre-noise-filter (slightly inflated); the value at `status: complete` is authoritative. If the UI ever shows a count that *decreases* late in the run, that's the expected swap from raw to scored — not a bug.
- **Don't accept `npm audit fix --force` on `firebase-admin`/`next`** — both bumps suggested by audit are catastrophic downgrades (firebase-admin@10, next@9). Real fixes are upstream or via `overrides` (the postcss one); the uuid chain is accepted-risk (see "Security posture" section).

---

## Subsystem docs

- [tests/CLAUDE.md](tests/CLAUDE.md) — check modules, Playwright gotchas (toHaveScreenshot, ATC timing, lazy-load)
- [scripts/CLAUDE.md](scripts/CLAUDE.md) — pipeline scripts, noise filter config, report/orchestrate gotchas, runner-daemon
- [src/report/CLAUDE.md](src/report/CLAUDE.md) — HTML/PDF report generation, dedup fingerprint details
- [web/CLAUDE.md](web/CLAUDE.md) — Next.js dashboard, theme system, Firestore schema, diff view
- [docs/HISTORY.md](docs/HISTORY.md) — session fix history and key insights
