# Ryze QA Agent

Automated bug-hunting agent that crawls **ryzesuperfoods.com** and **shop.ryzesuperfoods.com**, deduplicates bugs by Shopify section, and produces a `.docx` audit report. Full technical spec is in [setup.md](setup.md).

**Target sites:** https://www.ryzesuperfoods.com · https://shop.ryzesuperfoods.com
**Output:** `output/audit-report-<date>.docx`

---

## Commands

```bash
pnpm install          # install deps (Node 20+)
pnpm test:crawl       # discover URLs → output/url-list.json
pnpm test:audit       # run all checks → output/bugs.jsonl
pnpm report           # dedupe + build .docx
pnpm full-audit       # crawl + audit + report in sequence
```

---

## Architecture

```
sitemap.xml → URL list → Playwright test suite (3 viewports) → bugs.jsonl
                                                                    ↓
                                                             fingerprint dedup
                                                                    ↓
                                                            docx report builder
```

Key directories (once scaffolded):
- `tests/` — Playwright specs + fixtures (see [setup.md](setup.md) §10 for full layout)
- `src/crawl/` — sitemap parser, linkinator runner
- `src/dedupe/` — fingerprint algorithm, selector-path walker, perceptual hash
- `src/annotate/` — sharp+SVG screenshot annotation
- `src/report/` — docx builder, optional Drive uploader
- `data/` — allowlist-domains.txt, brand-dictionary.txt, bugs.jsonl
- `output/` — screenshots, lighthouse reports, final .docx

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

## Dedup fingerprint

`SHA1(ruleId + normalizedMessage + sectionAnchor + truncated_dHash)`
Two bugs merge if fingerprints match, OR if rule+message match AND dHash Hamming ≤ 5.
See `src/dedupe/fingerprint.ts`.

---

## Severity ladder

| Level | Examples |
|-------|---------|
| Critical | Broken ATC, checkout handoff fails, price=NaN/$0, JS pageerror on PDP/cart |
| High | WCAG 2.1 A violations, broken internal links, broken hero images, missing canonical/JSON-LD on PDP |
| Medium | WCAG 2.1 AA violations, broken external links, layout shift >0.25, Lighthouse perf <50 |
| Low | Typos, contrast 4.0–4.4, broken third-party tracking pixel |

---

## Known noise — exclude from scans

- Klaviyo iframe, Gorgias chat widget, Meta Pixel, TikTok pixel, GTM
- `.myshopify.com` requests after checkout handoff
- Stock-out countdown timers (mask in visual diffs)

---

## Key gotchas

- Shopify lazy-loads images via IntersectionObserver — scroll to bottom + back before screenshots
- Edgemesh CDN returns 429 if requests are too fast — back off, don't retry-storm
- `shop.ryzesuperfoods.com` is headless (likely Hydrogen) — missing JSON-LD/canonicals may be intentional; flag as advisories, not defects
- Pixelmatch false positives on webfonts — tune `threshold` to 0.2–0.35
- Perceptual-hash dedup can over-merge at Hamming ≤5 — consider tuning to ≤3–4
- DOM price selectors (`[data-product-price]`, `.price__current`) are assumptions — verify against live DOM on first run
