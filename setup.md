# Automated QA / Bug-Hunting Stack for Claude Code in VS Code — Built for ryzesuperfoods.com & shop.ryzesuperfoods.com

## TL;DR
- **Recommended stack:** Playwright (the test runner + the official Microsoft VS Code extension + the Playwright MCP server) as the foundation, plus `@axe-core/playwright` for accessibility, `linkinator` for broken links, `pixelmatch`/`odiff` (built into Playwright) for visual diffs, `playwright-lighthouse` for perf/SEO, `cspell` for typos, `sharp-phash` for screenshot deduplication, and `docx` (npm) for the final Word report — with optional Google Docs API fallback. Everything runs locally inside VS Code with Claude Code orchestrating via a CLAUDE.md "playbook."
- **How dedup works:** A bug isn't `(URL, message)` — it's a fingerprint of `(rule_id or error_signature) + DOM-ancestor-selector-path + perceptual-hash of the offending element screenshot`. The same Shopify section appearing on home/PDP/collection pages collapses to one bug with a list of affected URLs.
- **Setup time for a Technical PM:** ~1–2 hours. Claude Code does almost all of it given a properly seeded `CLAUDE.md` and `.claude/` skill directory. No credentials, no checkout-completion, no Shopify admin touched — only public, unauthenticated pages discovered from the sitemap. The single biggest gotcha is Shopify's recent change to its default `robots.txt` disallowing automated agentic flows, so the crawler must be a respectful, slow, identifiable crawler that stays on public pages.

---

## Key Findings

### 1. Foundation: Playwright + VS Code + Claude Code is the right base
Playwright (TypeScript) is the dominant headless-browser test framework in 2026 and is the only stack where all four of these line up cleanly: an official Microsoft **Playwright Test for VS Code** extension (Test Explorer, gutter run buttons, Trace Viewer, locator picker, code-gen), an official **Playwright MCP server** (`@playwright/mcp`) that Claude Code can drive via accessibility-tree snapshots, built-in screenshot comparison via pixelmatch, and first-class TypeScript fixtures. Use Playwright Test (`@playwright/test`) — not raw `playwright` — because the `expect(page).toHaveScreenshot()`, projects (per-browser/viewport), HTML reporter, and trace viewer features ship for free.

Wire Playwright MCP into Claude Code with one of:
```bash
claude mcp add playwright npx @playwright/mcp@latest
```
…or via `.vscode/mcp.json` so the configuration is checked into the repo and Claude Code in VS Code picks it up automatically. Persistent profile mode (default) keeps cookies between sessions; pass `--isolated` for clean runs. The MCP exposes `browser_navigate`, `browser_click`, `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests`, and `browser_run_code` (arbitrary Playwright JS) — which is exactly the surface a bug-hunting agent needs.

### 2. Test surface: what bugs we actually catch
| Bug class | Tool | Detection signal |
|---|---|---|
| Console JS errors / unhandled exceptions | Playwright `page.on('pageerror')` and `page.on('console', m => m.type()==='error')` | Capture into a per-page array; non-empty = bug |
| Failed network requests (broken images, failed analytics, 4xx/5xx XHR) | `page.on('requestfailed')` and `page.on('response', r => r.status()>=400)` | Status code, URL, initiator |
| Broken links (internal & external) | `linkinator` (recursive, JSON output, per-status-code rules) | `state: 'BROKEN'` |
| Accessibility (incl. duplicate IDs, contrast, missing alt, missing labels) | `@axe-core/playwright` with `withTags(['wcag2a','wcag2aa','wcag21aa'])` | `violations[]` with `id`, `impact`, `nodes[].target` |
| Visual regressions / layout shifts | `expect(page).toHaveScreenshot()` (pixelmatch) with `maxDiffPixelRatio:0.02, threshold:0.2, animations:'disabled'` | Diff image generated automatically |
| Typos in visible content | `cspell` run against extracted page text + a project dictionary of brand terms ("RYZE", "Cordyceps", "Reishi", "Lion's Mane", etc.) | Unknown words flagged |
| Performance / SEO / a11y category scores | `playwright-lighthouse` (Chrome only, single Chromium project, port 9222) | Threshold breaches |
| Revenue-impacting: PDP price/variant rendering, Add-to-Cart works, cart page math | Bespoke Playwright specs with assertions on DOM (`[data-product-price]`, `[name=add]`, cart subtotal) | Missing/zero/NaN price, ATC button absent or throws, subtotal ≠ Σ line items |

For accessibility, axe-core is the engine inside Lighthouse, Google's a11y guidance, and almost every commercial scanner; `@axe-core/playwright` is the canonical integration and Deque maintains it. Use `AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()` and stash results — don't `expect(violations).toEqual([])` because we want to *report*, not fail. Apply `.exclude()` for known third-party widgets you don't control (Klaviyo, Gorgias, ad pixels) so you don't drown in noise.

### 3. Visual regression: keep it free and local
For this use case (pre-launch sweep, no baselines yet), **do not adopt Percy/Applitools/Chromatic** — they're cloud-based, require accounts, paid past free tiers, and add CI complexity. The free path is:
- **Built-in `expect(page).toHaveScreenshot()`** (uses pixelmatch under the hood) for baseline-vs-current diffing once you've run the suite once. First run creates baselines; subsequent runs detect regressions.
- **BackstopJS** is the next step up and still free, with a polished HTML diff report — but it adds a separate config schema and runs alongside Playwright awkwardly. Skip unless you need a dedicated baseline gallery.
- **odiff** (`odiff-bin`) is a SIMD-optimized drop-in replacement for pixelmatch that's ~6–8× faster on full-page screenshots; integrate via `playwright-odiff` if scan time becomes painful.

### 4. Console errors, network errors, broken links — the cheapest wins
The most ROI-positive checks are also the simplest in Playwright:
```ts
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const failedRequests: { url: string; status: number; method: string }[] = [];

page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(e.message));
page.on('requestfailed', r => failedRequests.push({ url: r.url(), status: 0, method: r.method() }));
page.on('response', async r => { if (r.status()>=400) failedRequests.push({ url: r.url(), status: r.status(), method: r.request().method() }); });
```
Filter out known noise with a denylist (third-party scripts you don't own — Meta Pixel, Klaviyo, TikTok, Google Tag Manager). On Shopify storefronts these are extremely chatty and would otherwise drown the report.

For broken-link discovery, **`linkinator`** is the modern winner (actively maintained by a Google engineer, JSON+CSV output, recursive, retry on 429, GitHub Action available, configurable `--status-code "403:warn"` rules). The legacy `broken-link-checker` (`blc`) still works but the package shows minimal recent maintenance. Run `linkinator` separately from the Playwright suite — it's dramatically faster than spinning up a browser per URL — and merge its output into the bug DB.

### 5. Crawl strategy for ryzesuperfoods.com & shop.ryzesuperfoods.com
- **Discovery:** Fetch `https://www.ryzesuperfoods.com/sitemap.xml` (Shopify auto-generates these — main + `sitemap_products_*.xml`, `sitemap_collections_*.xml`, `sitemap_pages_*.xml`). Parse with `xml2js` or `fast-xml-parser`. Do the same for `shop.ryzesuperfoods.com`.
- **Categorize URLs** into: `home`, `product` (`/products/*`), `collection` (`/collections/*`), `page` (`/pages/*`), `blog` (`/blogs/*/*`), `cart` (`/cart`), `policies`. The categorization drives which bug rules apply (e.g. price-rendering check only runs on `product` pages).
- **Sample, don't exhaust:** ryzesuperfoods.com has likely 30–80 product pages and dozens of collection/page URLs. Crawl all `home`, `cart`, `policies`, `pages/*`, all collections, plus every product (the "module-on-many-pages" dedup is exactly why we want full PDP coverage). Cap blog posts at the 20 most recent.
- **Throttle:** 1–2 concurrent workers (`p-limit`), `Crawl-delay` of ~2 seconds between requests, custom user-agent like `RyzeQABot/0.1 (+contact@…)` so it's visible in logs and not mistaken for an attack.
- **Three viewports per page:** desktop (1440×900), tablet (768×1024), mobile (390×844). Many revenue-impacting bugs (overlapping CTAs, broken sticky bars) only show on mobile.

### 6. Headless Shopify (`shop.ryzesuperfoods.com`) gotchas
The headless surface (almost certainly a Shopify Hydrogen or custom React funnel/landing app) behaves materially differently from the Liquid storefront:
- **No Liquid theme = no automatic `robots.txt`, structured data, or schema defaults** — bugs around missing OG tags, missing canonical URLs, missing `Product` JSON-LD, and missing meta descriptions are *much* more common on the headless host. Add a SEO-meta check that asserts each PDP has at least: `<title>`, `<meta name=description>`, `<link rel=canonical>`, and a `Product` JSON-LD block with `offers.price`.
- **Cart state is held by Storefront API tokens, not Shopify session cookies.** Don't try to add to cart from one host and expect state on the other.
- **Checkout always redirects to `*.myshopify.com` or `checkout.ryzesuperfoods.com`** — the headless app hands off, so the bug-hunt's last functional step on a PDP/cart is "Add to Cart" + "Proceed to Checkout button is enabled and points to a checkout host." Do NOT proceed past checkout init (no credentials, no payment).
- **Recent (March 2026) Shopify policy change:** the default `robots.txt` now disallows "automated scraping, buy-for-me agents, or any end-to-end flow that completes payment without a final human review step." Our crawler stays well clear because (a) it's read-only, (b) it never completes payment, (c) it identifies itself, and (d) it respects `robots.txt`. Have the crawler honor `robots.txt` via `robots-parser` to be safe.
- **CDN / WAF:** RYZE uses Edgemesh in front of Shopify. If you hammer with parallel workers, expect to see 429s. Throttle.

### 7. The deduplication algorithm — the heart of the system
The brief explicitly asks for "same Shopify module bug across pages = ONE bug." Approach:

A **bug instance** captured during crawl looks like:
```
{ ruleId, severity, message, url, viewport,
  selector,            // full CSS path from <html> to the offending node
  selectorAncestry,    // array of ancestor tag+role+data-section-type
  outerHTMLSnippet,    // first 256 chars of element's outerHTML
  elementScreenshot,   // PNG buffer of just the element + 20px padding
  pageScreenshot       // full-page PNG (for context)
}
```

A **bug fingerprint** (the dedup key) is a SHA-1 of the concatenation of:
1. `ruleId` (e.g. `axe:color-contrast`, `console:TypeError`, `network:404`, `visual:layout-shift`)
2. **Normalized message** — strip URLs, IDs, dates, numbers (`Failed to load /products/abc.jpg` → `Failed to load /products/*.jpg`)
3. **Component anchor** — walk up from the offending element to the nearest ancestor with a stable Shopify section signal: `[data-section-type]`, `[data-section-id]` (drop the numeric ID, keep the type), `[id^="shopify-section-"]`, or a class matching `/^(section|sec)-/`. This is the closest thing Shopify gives you to "which Liquid section did this come from."
4. **8-bit perceptual hash** (`sharp-phash` / `dHash`, 64-bit hash, Hamming distance ≤ 5 = same) of the cropped element screenshot. This catches the case where two pages have visually identical broken hero modules even when the DOM differs slightly.

Keys 1–3 give a deterministic match; key 4 catches near-duplicates. Two bug instances merge into one bug record if their first three keys match exactly OR if keys 1–2 match AND visual-hash Hamming distance ≤ 5. The merged record stores **all** affected URLs and viewports, plus *one* representative screenshot.

Reference libraries:
- `sharp-phash` (perceptual dHash, fast, pure-JS via sharp) — recommended.
- `imagemagick`/`pHash` C-bindings exist but add native deps.
- For the selector-path normalization, write a 30-line Playwright helper that walks `el.parentElement` until it hits a section anchor, building `tag[role][data-section-type]` along the way.

### 8. Screenshot capture & annotation best practices
- **Disable animations and lazy-load:** `await page.emulateMedia({ reducedMotion: 'reduce' })`, scroll to bottom and back to force lazy images to resolve, then `await page.waitForLoadState('networkidle')` with a timeout.
- **Mask volatile regions** (carousels, countdown timers, "X people are viewing this" widgets) with `expect(page).toHaveScreenshot({ mask: [page.locator('.dynamic-banner'), page.locator('[data-countdown]')], maskColor: '#FF00FF' })` — pink boxes are intentional and clearly read on the report.
- **Capture both element and full-page** for every bug. The element shot is what goes in the report and feeds the perceptual hash; the full-page shot is reference for "where on the page did this happen." Use `locator.screenshot({ path, animations:'disabled' })` for the element and `page.screenshot({ fullPage: true, path })` for context.
- **Annotation = draw a red rectangle** around the offending element's bounding box on the full-page shot. `sharp` can do this via SVG composite — render an SVG with a transparent background and a `<rect stroke="red" stroke-width="4">` matching the element's `boundingBox()`, then `sharp(pageBuffer).composite([{ input: svgBuffer, top:0, left:0 }]).toBuffer()`. `jimp` works too but is slower. Avoid `node-canvas` (native deps, painful on Windows).
- **File naming:** `screenshots/<bugFingerprint>/<viewport>/<urlSlug>.png` so dedup is visible at the filesystem level too.

### 9. Report generation: pick docx (npm) for v1
**Recommendation: ship the report as a `.docx` using the `docx` npm package** (Dolan Miu's library). Reasons:
- No OAuth, no Google Cloud project, no service account JSON, no API quota — runs offline.
- Native support for inline images, tables, headings, page breaks, hyperlinks, and Word styles. Adding a screenshot is `new ImageRun({ data: fs.readFileSync(path), transformation: { width: 600, height: 400 } })`.
- The output `.docx` opens cleanly in Google Docs (uploaded into Drive), Microsoft Word, and Apple Pages. So a "Google Doc" can still be the deliverable — just upload the docx and Drive auto-converts.
- Active maintenance, 533+ downstream projects, MIT license.

Alternative paths you should know about:
- **`docxtemplater`** is more powerful (loops, conditionals, image module is paid) when you want a Word template designers can edit and the script just fills it in. Overkill for v1; great for v2.
- **`docx-templates`** (note the hyphen — different package) is template-based and free, supports embedded JS in templates and dynamic images. Good middle ground.
- **Google Docs API direct** — supported via `googleapis` npm. Workflow: `documents.create` → `documents.batchUpdate` with `insertText` and `insertInlineImage` requests (image must be a public URL or a Drive file ID — you'd upload PNGs to Drive first via the Drive API). Adds a meaningful auth burden (OAuth client + tokens). Use this only if leadership specifically wants live, shareable, edit-tracked Google Docs.

The recommended approach: generate a `.docx` locally, then optionally have Claude Code use a Drive MCP / `googleapis` to upload+convert to Docs as a final step the user can opt into.

**Report structure:**
1. **Cover** — site(s) audited, crawl date, total pages crawled, total unique bugs.
2. **Severity summary table** — Critical / High / Medium / Low counts, plus a row per bug class (a11y, console, network, visual, content/typo, perf).
3. **Revenue-impact callout section** — bugs touching `/cart`, `/products/*`, pricing display, ATC, checkout handoff. Promoted to top regardless of axe severity.
4. **Bug detail pages** (one per unique bug, in severity order):
   - Bug ID (the fingerprint, first 8 chars), title, severity, class
   - Plain-English description ("Color contrast on PDP price is 3.2:1, fails WCAG 2.1 AA")
   - **Affected URLs** (deduplicated list — this is the killer feature)
   - **Affected viewports**
   - **Annotated full-page screenshot** + **element close-up screenshot**
   - Selector path / DOM snippet
   - Suggested fix or remediation link (axe-core provides these natively in `violation.helpUrl`)
5. **Appendix** — raw JSON dump of all bug instances and their fingerprint mapping (for engineering follow-up).

### 10. CLAUDE.md & project structure for autonomous runs

**Project structure:**
```
ryze-qa/
├── CLAUDE.md                       # The orchestration playbook (see below)
├── .claude/
│   ├── settings.json               # Permissions, hooks, MCP allowlist
│   ├── skills/
│   │   ├── crawl-site/SKILL.md     # How to discover URLs from sitemap
│   │   ├── run-checks/SKILL.md     # How to invoke each detector
│   │   ├── dedupe-bugs/SKILL.md    # The fingerprint algorithm
│   │   └── build-report/SKILL.md   # docx assembly
│   └── commands/
│       └── full-audit.md           # /full-audit slash command
├── .vscode/
│   ├── mcp.json                    # Playwright MCP server registered here
│   └── extensions.json             # Recommends Playwright Test, axe Linter
├── playwright.config.ts            # Projects: chromium-desktop/tablet/mobile + chromium-lighthouse
├── tests/
│   ├── crawl.spec.ts               # Sitemap-driven page sweep
│   ├── checks/
│   │   ├── a11y.ts                 # axe-core wrapper
│   │   ├── console.ts              # console+pageerror collector
│   │   ├── network.ts              # 4xx/5xx and requestfailed collector
│   │   ├── visual.ts               # toHaveScreenshot wrapper with masking
│   │   ├── seo.ts                  # canonical/og/jsonld checks
│   │   ├── revenue.ts              # PDP price/ATC, cart math, checkout handoff
│   │   └── content.ts              # cspell-driven typo scan
│   └── fixtures/
│       └── bug-collector.ts        # Test fixture that auto-pushes to bug DB
├── src/
│   ├── crawl/
│   │   ├── sitemap.ts              # parse sitemap.xml → URL list
│   │   └── linkinator-runner.ts    # broken link sweep
│   ├── dedupe/
│   │   ├── fingerprint.ts          # the SHA-1 hash function
│   │   ├── selector-path.ts        # walk to nearest section ancestor
│   │   └── perceptual-hash.ts      # sharp-phash wrapper
│   ├── annotate/
│   │   └── draw-rect.ts            # sharp+SVG rectangle composite
│   └── report/
│       ├── docx-builder.ts         # docx assembly
│       └── gdocs-uploader.ts       # optional Drive→Docs conversion
├── data/
│   ├── allowlist-domains.txt       # don't flag external scripts from these
│   ├── brand-dictionary.txt        # cspell project dictionary
│   └── bugs.jsonl                  # accumulated bug DB across runs
├── output/
│   ├── screenshots/<fingerprint>/…
│   ├── lighthouse-reports/…
│   └── audit-report-<date>.docx
└── package.json
```

**`CLAUDE.md` core principles** (kept short — research shows frontier models follow ~150–200 instructions; CLAUDE.md should focus on *what Claude consistently gets wrong*, not exhaustive style guides):

```md
# Ryze QA Bot — Project Charter

## Goal
Autonomously crawl ryzesuperfoods.com and shop.ryzesuperfoods.com,
detect bugs, deduplicate, and produce output/audit-report-<date>.docx.

## What You Are Allowed To Do
- Read sitemap.xml from both hosts.
- Visit any GET-accessible page on either host with `RyzeQABot` user-agent.
- Add items to cart (it's a public, server-side cart — no auth needed).
- Click "Proceed to Checkout" and CONFIRM IT LOADS, then immediately abort.

## What You Are NOT Allowed To Do
- Submit any form that creates a real account, real subscription, or real order.
- Enter any payment info — ever.
- Visit /admin, /account/login, or any URL requiring credentials.
- Run more than 2 concurrent browser contexts. Throttle 1.5s between page loads.
- Bypass robots.txt. Honor it via robots-parser before each navigation.

## Tech Stack (Don't Substitute Without Asking)
- Node 20+, TypeScript, Playwright Test
- @axe-core/playwright for a11y
- linkinator for broken-link sweep
- sharp + sharp-phash for screenshot ops
- cspell for typo detection
- docx (npm) for report generation
- playwright-lighthouse for Lighthouse audits

## How To Run
- `pnpm test:crawl` — discover URLs into output/url-list.json
- `pnpm test:audit` — run all checks, write output/bugs.jsonl
- `pnpm report` — dedupe + build .docx

## Bug Fingerprint
SHA1(ruleId + normalizedMessage + sectionAnchor + truncated_dHash).
Two bugs merge if fingerprints match OR (rule+message match AND dHash Hamming ≤ 5).
See src/dedupe/fingerprint.ts.

## Severity Ladder
- Critical: revenue-blocking (broken ATC, checkout handoff fails, price=NaN/$0, JS error on PDP/cart)
- High: WCAG 2.1 A violations, broken internal links, broken hero images, missing canonical/JSON-LD on PDP
- Medium: WCAG 2.1 AA violations, broken external links, layout shift > 0.25, lighthouse perf < 50
- Low: typos, contrast 4.0–4.4, broken third-party tracking pixel
Tag each bug with severity at creation time.

## Out-of-Scope (False Positives Likely)
- Klaviyo iframe, Gorgias chat widget, Meta Pixel — exclude from a11y scans
- Anything from .myshopify.com after checkout handoff
- Stock-out flash sale countdown timers (mask in visual diffs)

## Key Gotchas
- Shopify lazy-loads images via IntersectionObserver — scroll to bottom + back before screenshots
- The two hosts share a brand but NOT a cart. Treat them as independent sites.
- Some product variants are subscription-only — skip the variant picker entirely
- Edgemesh CDN can return 429 if you go fast. Slow down, don't retry-storm.
```

**`.claude/settings.json` highlights:**
- `permissions.allow`: `["Bash(npx playwright …)", "Bash(pnpm …)", "Read(./output/**)", "Write(./output/**)"]`.
- `permissions.deny`: `["Bash(curl … -X POST …)" `, `"Edit(./.env*)"`, `"Bash(* checkout … pay …)"`].
- A `PostToolUse` hook on Edit that runs `pnpm tsc --noEmit` so Claude doesn't drift on types.

**Slash command** `/full-audit` reads CLAUDE.md, runs the crawl → checks → dedupe → report pipeline, and posts a one-paragraph summary plus the report path.

### 11. VS Code extensions to install alongside

| Extension | Purpose |
|---|---|
| **Playwright Test for VSCode** (Microsoft, `ms-playwright.playwright`) | Test Explorer, gutter run buttons, Trace Viewer, locator picker, codegen, Show Browser mode |
| **axe Accessibility Linter** (Deque, free for personal use, 600k+ installs) | Static a11y lint of source code as Claude writes the test files |
| **ESLint** + **Prettier** | Standard hygiene; Claude generates cleaner code with these enabled |
| **Error Lens** | Inline display of TS/lint errors so Claude sees them in feedback loops |
| **Playwright MCP** (registered via `.vscode/mcp.json`, not a separate extension) | The agentic browser surface |

Note that the `axe DevTools` browser extension is a separate tool used for ad-hoc human review — it's not part of the automated stack but is useful if a PM wants to spot-check a flagged page.

### 12. Specific package picks (full `package.json` devDependencies list)

```json
{
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "@axe-core/playwright": "^4.10.0",
    "playwright-lighthouse": "^4.0.0",
    "lighthouse": "^12.0.0",
    "linkinator": "^6.1.0",
    "sharp": "^0.33.0",
    "sharp-phash": "^2.2.0",
    "cspell": "^8.0.0",
    "docx": "^9.0.0",
    "fast-xml-parser": "^4.5.0",
    "robots-parser": "^3.0.0",
    "p-limit": "^6.0.0",
    "zod": "^3.23.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0"
  }
}
```

**Optional adds, only if needed:**
- `odiff-bin` + `playwright-odiff` if pixelmatch is too slow (>3s per full-page diff).
- `googleapis` if you decide to upload to Google Docs natively.
- `@modelcontextprotocol/sdk` only if you write a custom MCP server (not necessary for v1).

All packages above are widely used (most have millions of weekly downloads), MIT or Apache-licensed, and have active maintenance — none are abandoned.

### 13. Practical run flow (what a PM actually clicks)

1. Open the `ryze-qa/` folder in VS Code with Claude Code.
2. Tell Claude: "Read CLAUDE.md and run a full audit of both ryzesuperfoods.com and shop.ryzesuperfoods.com." Claude reads CLAUDE.md, walks the skills, runs `pnpm test:crawl`.
3. Claude reports back: "Found 142 URLs. Running checks across desktop/tablet/mobile. ETA ~25 minutes."
4. Claude streams progress in chat. The Playwright VS Code panel shows tests passing/failing in the gutter; Trace Viewer is one click away on any failure.
5. Claude runs the dedupe pass and reports: "47 unique bugs across 142 pages. 6 Critical, 11 High, 22 Medium, 8 Low."
6. Claude runs `pnpm report` and prints: `output/audit-report-2026-04-30.docx — 47 bugs, 94 screenshots embedded.`
7. PM opens the docx (or asks Claude to upload it to Drive).

---

## Details

### Playwright config sketch

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 2,                            // be polite to Edgemesh+Shopify
  retries: 1,                            // network blips, not a real bug source
  reporter: [['html', { open: 'never' }], ['json', { outputFile: 'output/raw.json' }]],
  use: {
    userAgent: 'RyzeQABot/0.1 (+pm@ryze.example)',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: 'disabled',
      scale: 'css',
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet',  use: { ...devices['iPad (gen 7)'] } },
    { name: 'mobile',  use: { ...devices['iPhone 14'] } },
    { name: 'lighthouse', use: { browserName: 'chromium', launchOptions: { args: ['--remote-debugging-port=9222'] } } },
  ],
});
```

### Bug-collector fixture (the glue that makes everything route to dedup)

```ts
// tests/fixtures/bug-collector.ts
export const test = base.extend<{ bugs: BugCollector }>({
  bugs: async ({ page }, use, testInfo) => {
    const collector = new BugCollector(testInfo);
    page.on('console',   m => m.type()==='error' && collector.add({ ruleId:'console:error', message:m.text(), severity:'high' }));
    page.on('pageerror', e => collector.add({ ruleId:'js:pageerror', message:e.message, severity:'critical' }));
    page.on('response', async r => {
      if (r.status() >= 400 && new URL(r.url()).hostname.endsWith('ryzesuperfoods.com')) {
        collector.add({ ruleId:`network:${r.status()}`, message:r.url(), severity: r.status()>=500 ? 'critical' : 'high' });
      }
    });
    await use(collector);
    await collector.flush();   // append to data/bugs.jsonl
  },
});
```

### Revenue-impact spec — what's worth manually authoring

These don't lend themselves to fully autonomous discovery; have Claude write them once based on RYZE's PDP markup:

```ts
test('PDP renders price, has working ATC, hands off to Shopify checkout', async ({ page, bugs }) => {
  for (const url of pdpUrls) {
    await page.goto(url);
    const priceText = await page.locator('[data-product-price], .price, .price__current').first().textContent();
    if (!priceText || !/\$\d/.test(priceText)) bugs.add({ ruleId:'revenue:no-price', message:`No price on ${url}`, severity:'critical', url });
    const atc = page.getByRole('button', { name: /add to cart|subscribe/i }).first();
    if (!(await atc.isVisible())) bugs.add({ ruleId:'revenue:no-atc', message:`No ATC on ${url}`, severity:'critical', url });
    await atc.click();
    await page.waitForLoadState('networkidle');
    await page.goto('/cart');
    const subtotal = await page.locator('[data-cart-subtotal], .cart__subtotal').textContent();
    if (!subtotal || !/\$\d/.test(subtotal||'')) bugs.add({ ruleId:'revenue:cart-subtotal-missing', message:`Cart subtotal missing after ATC from ${url}`, severity:'critical', url });
    const checkout = page.locator('button[name="checkout"], a[href*="checkout"]').first();
    if (!(await checkout.isEnabled())) bugs.add({ ruleId:'revenue:checkout-disabled', message:`Checkout button disabled with item in cart`, severity:'critical', url });
    // Do NOT click checkout — it could create real session state.
  }
});
```

### Lighthouse, scoped narrowly

Run Lighthouse on **5–10 representative pages only** (homepage, top-3 PDPs, top-2 collections, cart, one blog post) — running it on all 100+ pages takes ~30+ minutes and yields highly redundant data. Use the `lighthouse` CLI with `--chrome-flags="--headless --remote-debugging-port=9222"` driven by `playwright-lighthouse`'s `playAudit({ page, port:9222, thresholds:{ performance:50, accessibility:80, seo:80 } })`. Capture the HTML report, attach it to the docx as a hyperlink (not embedded — too big), and surface only the score deltas as bugs (e.g. "Homepage performance score 38 / target 50").

### Report rendering with `docx`

```ts
import { Document, Packer, Paragraph, ImageRun, HeadingLevel, Table, TableRow, TableCell } from 'docx';
const bugSection = (b: Bug) => [
  new Paragraph({ heading: HeadingLevel.HEADING_2, text: `${b.severity.toUpperCase()} — ${b.title}` }),
  new Paragraph(`Bug ID: ${b.fingerprint.slice(0,8)} · Affects ${b.urls.length} page(s) · Viewports: ${b.viewports.join(', ')}`),
  new Paragraph(b.description),
  new Paragraph({ children: [ new ImageRun({ data: fs.readFileSync(b.elementShot), transformation:{ width:600, height:400 } }) ] }),
  new Paragraph({ children: [ new ImageRun({ data: fs.readFileSync(b.annotatedPageShot), transformation:{ width:600, height:800 } }) ] }),
  ...b.urls.map(u => new Paragraph({ text: `• ${u}`, bullet:{ level:0 } })),
];
```

---

## Caveats

- **Automation only catches ~30–50% of accessibility bugs.** Axe's own marketing puts auto-detectable issues at 57% of total a11y problems; Deque, the maintainer, repeatedly emphasizes that human screen-reader testing remains required for full WCAG conformance. The report will be valuable but is *not* a compliance audit.
- **Pixelmatch produces false positives on fonts and anti-aliasing.** Expect to tune `threshold` upward (0.2–0.35) for Shopify themes that use icon fonts and webfonts; otherwise minor sub-pixel render differences flag every page.
- **Shopify's March 2026 robots.txt change** disallows automated agentic flows. Our crawler is read-only, identifies itself, respects robots.txt, and never completes a payment — but if Shopify's WAF tightens further, the bot may get rate-limited or 403'd. Build in graceful 429/403 handling and report blocked URLs as their own diagnostic bucket rather than treating them as bugs.
- **The headless host (`shop.ryzesuperfoods.com`) is architecturally different.** Many "bugs" found there (missing JSON-LD, missing canonicals) may be intentional design choices for a funnel page. Have a human review the headless findings before treating them as defects — flag them as "headless-site advisories" rather than mixing into the main bug list.
- **Perceptual-hash dedup has a real false-positive rate.** Two genuinely different broken modules with similar shapes (both rectangles with a missing image and an ATC button) can collapse together at Hamming-distance ≤ 5. Tune the threshold down to 3–4 for safety; accept that some over-reporting is the lesser evil versus under-reporting a critical bug.
- **The docx library cannot render charts or rich timeline views.** If leadership wants Lighthouse-style score graphs, you'll need to render PNGs server-side (`vega-lite` or `chart.js-node-canvas`) and embed those as images. Or add Google Docs API as a v2 deliverable for truly live dashboards.
- **None of this catches business-logic bugs** (e.g. "the discount code applies to the wrong SKU"). Those need test data, account state, and a human-defined oracle — explicitly out of scope for this unauthenticated, no-credentials phase.
- **CLAUDE.md drift:** instruction count >150 measurably degrades adherence. Keep CLAUDE.md tight; push details into `.claude/skills/*/SKILL.md` files that Claude loads only when relevant, using the progressive-disclosure pattern described in Anthropic's official Claude Code best practices.
- **Several detail observations carry forward-looking assumptions** about ryzesuperfoods.com selectors (`[data-product-price]`, `.price__current`, etc.) — these are typical Shopify Dawn-derived theme conventions but should be verified against the actual rendered DOM during the first run; the suite should fail loudly (not silently pass) if no price-bearing selector matches on a PDP.