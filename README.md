# Ryze QA Agent

Automated bug-hunting agent for [ryzesuperfoods.com](https://www.ryzesuperfoods.com) and [shop.ryzesuperfoods.com](https://shop.ryzesuperfoods.com). Crawls the live site, finds bugs across seven check modules, validates findings with Claude AI, and produces a self-contained HTML report with a PDF export.

## What it does

1. **Crawls** the sitemap and discovers all URLs (home, products, collections, blogs, pages)
2. **Audits** every URL across desktop, tablet, and mobile viewports using Playwright — checking accessibility, network errors, revenue flows, SEO, visual layout, content, and performance
3. **Validates** each finding using Claude AI agents — confirming real bugs and filtering false positives
4. **Discovers** additional human-observable bugs using four AI personas with distinct worldviews (revenue, UX, brand, technical)
5. **Scores** every finding by business impact — revenue issues first, then UX, then UI
6. **Reports** a self-contained HTML report (two tabs: by severity and by category) with LLM-generated plain-English summaries, cropped screenshots, and a print-ready PDF export

## Prerequisites

- Node 20+
- Google Chrome installed (uses system Chrome — no browser download)
- `ANTHROPIC_API_KEY` environment variable set (required for validate, discover, orchestrate steps)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Quick start

```bash
npm install
npm run test:crawl        # discover URLs → output/url-list.json
npm run test:audit        # run all checks → data/bugs.jsonl  (~3–5 hours)
npm run orchestrate       # validate + discover + score + report → output/audit-report-<date>.html + .pdf
```

Or run everything in one command (takes 4–6 hours):

```bash
npm run full-audit:v2
```

## Architecture

```
sitemap.xml → URL list → Playwright (3 viewports) → bugs.jsonl
                                                         │
                                              ┌──────────┴──────────┐
                                    validate.ts (Claude)    discover.ts (4 personas)
                                              └──────────┬──────────┘
                                                    scorer.ts
                                                         │
                                                   reverify.ts (Playwright)
                                                         │
                                                    report.ts → audit-report.html + .pdf
```

## Persona system

Each AI agent is controlled by a markdown file in `personas/`. The file becomes the agent's system prompt. To tune an agent's behaviour, edit its persona file — no code changes required.

| Persona | File | Focus |
|---|---|---|
| Orchestrator | `personas/orchestrator.md` | Scores findings, arbitrates conflicts |
| Revenue Hawk | `personas/revenue-hawk.md` | ATC flow, pricing, trust signals |
| Skeptical First-Timer | `personas/skeptical-first-timer.md` | Mobile nav, social proof, purchase path |
| Brand Purist | `personas/brand-purist.md` | Copy tone, naming consistency |
| Forensic Technician | `personas/forensic-technician.md` | Schema, analytics, canonicals |
| Dr. Marcus Chen | `personas/dr-marcus-chen.md` | QA system health evaluation |

### Adding a new persona

1. Create `personas/your-persona.md` with these sections: Background, Mandate, Blind Spots, Evidence Requirements, How to Frame Findings
2. Run `npm run lint:personas` to verify structure
3. Register the persona in `scripts/discover.ts` by adding it to the `PERSONAS` array

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

## Known gotchas

- **Edgemesh blocks `/pages/` and `/blogs/`** — Playwright gets `ERR_TOO_MANY_REDIRECTS` on ~97 URLs. These pages load fine for real users. Bot IP needs whitelisting in the Edgemesh dashboard.
- **Recharge ATC button takes 10–15s to render** — the subscription widget is JS-rendered. The ATC check waits 15s before flagging `revenue:no-atc`.
- **Active Shopify theme is `t/2676`** — CDN paths with other theme IDs are stale and filtered as noise.
- **System sleep during long audits** — run `caffeinate -dims &` before `full-audit:v2` to prevent macOS sleep.
- **`ANTHROPIC_API_KEY` not set** — `npm run orchestrate` will warn and fall back to raw Playwright findings if the key is missing.

## npm scripts reference

| Command | What it does |
|---|---|
| `npm run test:crawl` | Discover URLs from sitemaps |
| `npm run test:audit` | Run Playwright checks across all URLs |
| `npm run validate` | Claude validation pass on bugs.jsonl |
| `npm run discover` | Claude persona discovery pass |
| `npm run orchestrate` | validate + discover + score + reverify + report |
| `npm run report` | Dedupe + build HTML + PDF from bugs.jsonl (no scoring) |
| `npm run full-audit:v2` | clean + crawl + audit + orchestrate |
| `npm run clean` | Clear bugs.jsonl and intermediate data files |
| `npm run dismiss` | Add a fingerprint to the dismissal list |
| `npm run test:unit` | Run scorer + evidence enforcer unit tests |
| `npm run test:smoke` | Run orchestrator smoke test |
| `npm run lint:personas` | Check persona file structure |
| `npm run tsc` | TypeScript type check |

## Contributing

- Don't substitute the tech stack without discussing first (see CLAUDE.md)
- All new persona files must pass `npm run lint:personas`
- The Playwright pipeline must remain the floor — new layers must fail gracefully
- Never submit payment, create accounts, or visit `/admin` or `/account/login`
