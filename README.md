# Ryze QA Agent

Automated bug-hunting agent for [ryzesuperfoods.com](https://www.ryzesuperfoods.com) and [shop.ryzesuperfoods.com](https://shop.ryzesuperfoods.com). Crawls the live site, finds bugs across 13+ check modules, validates findings with Claude AI, gates them through a visual-verification LLM, and produces a self-contained HTML report with a PDF export.

## What it does

1. **Crawls** the sitemap (and the live `/debug/routes` + `/debug/split-tests` endpoints for `shop.`) and discovers all URLs (home, products, pages, blogs, cart, policies)
2. **Audits** every URL across desktop, tablet, and mobile viewports using Playwright — network errors, image integrity, SEO/JSON-LD/OG tags, currency formatting, search/newsletter functionality, external-link safety, mobile tap-target sizing, revenue flows (ATC → cart → quantity/discount/note/remove + cart-icon counter)
3. **Discovers** business-logic and brand bugs using 5 AI personas with distinct worldviews (revenue, UX, brand, technical, system-health)
4. **Validates** each finding using Claude AI — confirming real bugs and filtering false positives
5. **Visually gates** every image/network candidate with Sonnet 4.6 — bugs the LLM judges as not-visible to shoppers are routed to a separate suppressed report instead of the main one
6. **Scores** every finding by business impact — revenue issues first, then UX, then UI
7. **Reports** a self-contained HTML report (two tabs: by severity and by category) with LLM-generated plain-English summaries, cropped screenshots, and a print-ready PDF export. Plus a side-channel `audit-report-<date>-suppressed.html` for spot-checking gate decisions.

## Prerequisites

- Node 20+
- Google Chrome installed (uses system Chrome via Cloudflare O2O — no browser download)
- `ANTHROPIC_API_KEY` in a `.env` file at project root (required for validate, discover, gate, summaries, categorise)
- [lychee](https://lychee.cli.rs) on PATH (optional — only the cross-page link-integrity check needs it; see below)

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

## Link integrity (lychee)

The cross-page link-integrity check (`src/cross-page/links.ts`) shells out to
[**lychee**](https://lychee.cli.rs), a fast async link checker written in Rust.
It finds broken internal/outbound links and **broken anchor fragments**
(`#section` targets that never return an HTTP error and are invisible to the
page-level network check).

lychee is **not** bundled and is **never auto-installed** — install it yourself:

```bash
# macOS
brew install lychee

# or download a release binary for any platform:
# https://github.com/lycheeverse/lychee/releases

# verify
lychee --version    # tested against lychee 0.15.x
```

If `lychee` is not on your PATH, point the check at it via `.env`:

```bash
LYCHEE_BIN=/absolute/path/to/lychee
```

When lychee is missing, `checkLinks()` throws a clear startup error rather than
silently skipping. The check produces `cross-page:broken-link` and
`cross-page:broken-fragment` findings. The helper
`checkLinksInContainer(page, selector, runId, contextLabel)` validates only the
links inside a given DOM container — used by journey tests to catch links that
404 *only in context* (e.g. a privacy-policy link inside the checkout
disclaimer).

> **Note:** lychee writes a `.lycheecache` cache directory. Add it to
> `.gitignore` if you run the check at the repo root (or set `cacheDir`).

## Quick start

```bash
npm install
npm run test:crawl        # discover URLs → output/url-list.json
npm run test:audit        # run all Playwright checks → data/bugs.jsonl  (~3–5 hours)
npm run orchestrate       # validate + dedup + visual gate + score + summaries + report
```

Or run everything in one command:

```bash
npm run full-audit        # clean + crawl + [playwright ‖ personas] + orchestrate
```

Playwright and the agentic personas run in parallel via `scripts/run-audit.ts`. Both must finish before orchestrate starts.

For a fast, zero-cost local check (no LLM steps):

```bash
npm run audit-only        # clean + crawl + playwright + report (skips validate, personas, gate, summaries)
```

## Architecture

```
sitemap.xml + /debug/routes + /debug/split-tests → URL list
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
         Playwright (3 viewports)        5 agentic personas
         → data/bugs.jsonl              → data/discoveries.jsonl
                    └───────────────┬───────────────┘
                                    ▼
                               orchestrate
              validate · semantic-dedup · merge + SHA1 dedup
                  · visual gate · score · summaries · categories
                                    │
                ┌───────────────────┴───────────────────┐
                ▼                                       ▼
       audit-report-<date>.html              audit-report-<date>-suppressed.html
       audit-report-<date>.pdf               (LLM-gated false positives, for spot-check)
```

The **visual verification gate** sits between dedup and scoring. It sends each in-scope record's element + page screenshots to Sonnet 4.6 and routes results: `visible` and `uncertain` stay in the main report; `not-visible` goes to the suppressed report. Disable with `DISABLE_VISUAL_GATE=1`. See [CLAUDE.md](CLAUDE.md) for the gated rule set, failure modes, and tuning.

## Check modules

| Module | Purpose |
|---|---|
| `checks/network.ts` | Nav failures, 4xx/5xx, rate limits |
| `checks/image.ts` | Visible `<img src="">`, `<img>` with `naturalWidth === 0`, broken Replo `<picture>` srcset templates |
| `checks/seo.ts` | Canonical, JSON-LD presence, meta description presence |
| `checks/jsonld.ts` | JSON-LD integrity — parseable, `@context`, Product schema fields on PDPs |
| `checks/opengraph.ts` | OG completeness; PDP `og:type` must contain "product" |
| `checks/currency.ts` | Currency formatting consistency (`$1,234.56` vs `30 USD` mixed on same page) |
| `checks/revenue.ts` | ATC → cart subtotal/checkout/qty/discount/note/remove + cart-icon counter increment |
| `checks/search.ts` | Search-results rendering for `coffee`, `mushroom`, `matcha`, `starter` (www only) |
| `checks/newsletter.ts` | Newsletter form client-side email validation |
| `checks/external-links.ts` | `<a target="_blank">` missing `rel="noopener"` |
| `checks/tap-targets.ts` | Mobile-only — clickable elements smaller than 32×32px |
| `checks/console.ts` | JS console errors/warnings (filtered post-hoc — bot-context noise) |
| `checks/visual.ts` | Per-viewport screenshot capture |

`a11y.ts` (axe-core) and `content.ts` (cspell typo detection) exist but are permanently disabled — too noisy. See [CLAUDE.md](CLAUDE.md) "Checks permanently disabled."

## Persona system

5 AI agents browse the live site via Claude tool_use, controlled by markdown files in `personas/`. Each file IS the agent's system prompt — edit it to tune behaviour, no code changes required. All run on `claude-haiku-4-5-20251001`.

| Persona | File | Focus |
|---|---|---|
| Revenue Hawk | `personas/revenue-hawk.md` | ATC flow, pricing, deceptive urgency (countdown timers, discount math) |
| Skeptical First-Timer | `personas/skeptical-first-timer.md` | Mobile nav, social proof, purchase path |
| Brand Purist | `personas/brand-purist.md` | Copy tone, naming consistency, on/off-brand voice |
| Forensic Technician | `personas/forensic-technician.md` | Schema, analytics, canonicals, structured data |
| Dr. Marcus Chen | `personas/dr-marcus-chen.md` | QA system health evaluation |

### Adding a new persona

1. Create `personas/your-persona.md` with sections: Background, Mandate, Domain Exclusions, Evidence Requirements, Few-shot examples. See `personas/revenue-hawk.md` as a template.
2. Run `npm run lint:personas` to verify structure.
3. Register the persona in `scripts/discover-agentic.ts` by adding it to a batch in the `PERSONA_BATCHES` array. Keep each batch ≤ 2 personas (max 2 concurrent browser contexts).

## Scoring model

```
score = (impact_weight + page_importance + novelty_bonus) × consensus_multiplier − confidence_penalty

impact_weight:      revenue=4  |  a11y/network=2  |  visual/seo/content=1  |  console=0.5
page_importance:    home/PDP=3  |  collection=2  |  blog/policy=1
novelty_bonus:      +1 if fingerprint unseen in last 3 runs
consensus_multiplier: 1.5 if 2+ sources agree, else 1.0
confidence_penalty: 1 − confidence (0 for full confidence)
```

Severity floors by source:

| Source | Max severity label |
|---|---|
| Playwright deterministic | Any |
| Claude discovery (2+ personas agree) | Up to High |
| Claude discovery (lone persona) | Capped at Medium |

## Dismissing a false positive

After reviewing a report, dismiss a finding so it's suppressed in all future runs:

```bash
npm run dismiss -- --fingerprint <fingerprint-id> --reason "by design"
```

Fingerprint IDs appear in `data/scored-bugs.json` and in the report footer for each finding.

The visual gate suppresses a different class of false positive — bugs that are real at the DOM layer but invisible to shoppers (modals, far-below-fold, srcset-with-fallback). Those land in `audit-report-<date>-suppressed.html` with the LLM's reason — spot-check that file periodically.

## Known gotchas

- **Cloudflare O2O is the bot bypass** — system Chrome via `channel: 'chrome'` is allowed through. Headless/headed mode does NOT change noise levels; O2O already handles bot detection.
- **`shop.ryzesuperfoods.com` has no sitemap** — URL discovery falls back to live `/debug/routes` and `/debug/split-tests` endpoints fetched on every crawl.
- **Recharge ATC button takes 10–15s to render** — the subscription widget is JS-rendered. ATC check waits 15s before flagging `revenue:no-atc` (filtered as noise — too flaky).
- **Active Shopify theme is `t/2676`** — CDN paths with other theme IDs are stale and filtered.
- **System sleep during long audits** — `caffeinate -dims` may be overridden by MDM. Workaround: keystroke jiggler (`osascript -e 'key code 63'` every 50s).
- **`ANTHROPIC_API_KEY` not set** — `npm run orchestrate` will warn and degrade gracefully: validation and personas no-op; visual gate falls back to `verdict: 'uncertain'` for in-scope records and surfaces a "gate degraded" banner on the main report.

See [CLAUDE.md](CLAUDE.md) for the full gotcha catalogue.

## npm scripts reference

| Command | What it does |
|---|---|
| `npm run test:crawl` | Discover URLs from sitemaps + debug endpoints |
| `npm run test:audit` | Run Playwright checks across all URLs (3 viewports) |
| `npm run test:unit` | Run all unit tests (~476 tests, ~30s) |
| `npm run test:smoke` | Run orchestrator smoke tests |
| `npm run discover:agentic` | Run 5 agentic personas standalone |
| `npm run orchestrate` | Post-processing: validate + dedup + visual gate + score + summaries + report (requires `bugs.jsonl` to exist) |
| `npm run report` | Dedupe + visual gate + build HTML + PDF from bugs.jsonl (no scoring/summaries) |
| `npm run full-audit` | clean + crawl + [audit ‖ personas] + orchestrate |
| `npm run audit-only` | clean + crawl + playwright + report (no LLM — fast, zero cost) |
| `npm run clean` | Clear bugs.jsonl, scored-bugs, output reports, screenshots |
| `npm run dismiss` | Add a fingerprint to the dismissal list |
| `npm run lint:personas` | Check persona file structure |

## Contributing

- Don't substitute the tech stack without discussing first (see [CLAUDE.md](CLAUDE.md))
- All new persona files must pass `npm run lint:personas`
- The Playwright pipeline must remain the floor — new layers must fail gracefully
- Never submit payment, create accounts, or visit `/admin` or `/account/login`
