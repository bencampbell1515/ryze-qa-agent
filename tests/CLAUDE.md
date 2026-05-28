# Tests

Playwright test suite across 3 viewports: desktop (1440px), tablet (768px), mobile (390px).

## Key files

| File | Purpose |
|------|---------|
| crawl.spec.ts | Main orchestrator — loops URLs, calls all checks |
| fixtures/bug-collector.ts | Playwright fixture that accumulates bugs into `data/bugs.jsonl` |
| checks/a11y.ts | axe-core WCAG violations |
| checks/console.ts | JS console errors/warnings — **CURRENTLY DISABLED** (2026-05-27). `attachConsoleListeners()` is not called from `crawl.spec.ts` because every `console:error`/`js:pageerror` in headless Chrome is third-party noise. Re-enable only when audits move out of headless + blocked-GTM context. |
| checks/content.ts | Typos via cspell, broken images |
| checks/image.ts | Visible `<img src="">`, `<img>` with `naturalWidth === 0`, broken Replo `<picture>` srcset templates |
| checks/network.ts | Nav failures, 4xx/5xx, 429 rate limits |
| checks/revenue.ts | ATC → cart subtotal/checkout/qty/discount/note/remove + cart-icon counter increment (stop before clicking checkout) |
| checks/seo.ts | Canonical, JSON-LD presence, meta description presence |
| checks/visual.ts | Screenshot capture per viewport |
| checks/currency.ts | Currency formatting consistency (`$1,234.56` vs `$1234` vs `30 USD` mixed on same page) |
| checks/jsonld.ts | JSON-LD integrity: parseable, has `@context`, PDPs have valid `Product` schema with `name`/`image`/`offers.price`/`offers.priceCurrency` |
| checks/opengraph.ts | Open Graph completeness — `og:title/description/image/url/type` non-empty; PDP `og:type` must contain "product" |
| checks/search.ts | Search-results page rendering for queries `coffee`, `mushroom`, `matcha`, `starter` (runs once per audit on www only — shop. is Hydrogen, no /search) |
| checks/newsletter.ts | Newsletter signup form has client-side email validation (HTML5 validity, aria-invalid, error class/message) |
| checks/external-links.ts | `<a target="_blank">` missing `rel="noopener"` (security:link-noopener-missing) |
| checks/tap-targets.ts | Mobile-only — visible clickable elements smaller than 32×32px (Apple HIG ≥44×44); skips child anchors when an ancestor ≥32×32 is itself the tap target |

## Patterns

- Bug collector appends to `data/bugs.jsonl`; never overwrites. Always `npm run clean` before a fresh audit.
- 3 viewports run via Playwright projects (desktop/tablet/mobile); `lighthouse` project early-returns from `@audit` — it's a no-op for the URL audit.
- ATC flow is wrapped in a 35s `Promise.race` with an `aborted` flag to suppress ghost writes after timeout
- `ATC_SAMPLE_LIMIT = 5` per project — `resetAtcCount()` is called at the start of each `@audit` run so desktop/tablet/mobile each get their own 5-product budget
- `attachNetworkListeners` is called **once before the URL loop** — calling it inside the loop adds duplicate listeners that double-count every bug. (`attachConsoleListeners` is no longer called at all — see checks table above.)
- `test.setTimeout(0)` is required on the audit test — 229 URLs × checks would exceed Playwright's default 30s test timeout almost immediately
- `flush()` in `bug-collector.ts` skips when `testInfo.status !== 'passed' && testInfo.retry < testInfo.project.retries` — prevents partial-run data from being written before Playwright retries the test

## Gotchas

- **`toHaveScreenshot()` is banned** — creates baselines on first run, marks test FAILED on any site change. Use `page.screenshot()` with direct file save instead. If stale baselines cause errors, delete `tests/crawl.spec.ts-snapshots/`.
- **ATC button takes 10–15s** — Recharge subscription widget is JS-rendered; wait timeout is 15s. `revenue:no-atc` is noise-filtered in reports (too noisy). Do not reduce the wait below 15s.
- **ATC selector must include "Get Started"** — Recharge renders "Get Started" (not "Add to Cart") on RYZE subscription products. The selector regex in `checks/revenue.ts` is `/add to cart|subscribe|buy now|get started/i`. Do not remove `get started`.
- **Shopify lazy-loads images** — scroll to bottom + back before screenshots to trigger IntersectionObserver.
- **Cloudflare closes long-running sessions** — After ~4h the browser page gets closed mid-run (`ERR_TOO_MANY_REDIRECTS` or silent close). All `page.waitForTimeout()` calls inside the URL loop must have `.catch(() => {})` — otherwise the test crashes and the last viewport's bugs are lost. Previously Edgemesh blocked `/pages/`; those now load fine under Cloudflare.
- **ATC flow: always capture `productPageUrl = page.url()` before clicking** — after `atc.click()`, the page may navigate (Recharge redirect). `cartUrl` must be built from the saved URL, not `page.url()` post-click. After `runCartChecks`, navigate back: `await page.goto(productPageUrl)` so `runContentCheck` and `takeScreenshot` run against the product, not `/cart`.
- **`content:typo` check: tmpfiles go in `data/tmp/`** — cspell v8 silently skips files outside its working directory (`os.tmpdir()` returns `/var/folders/…`). Tmpfile must be inside the project root. Also: cspell exits non-zero when typos are found — parse `(err as any).stdout` in the catch block, not the try block return value.
- **`getSectionAnchor()` runs via `page.evaluate()`** — the function uses browser DOM APIs and is serialized + sent to the browser context by Playwright. It has no captured closure variables so serialization is safe. Returns `'document'` as fallback if the element isn't found.
- **`content:typo` scoped to brand-copy only** — the check uses a curated selector list (`h1-h6`, `button`, `nav a`, `.product__title`, `[class*="product__description"] p`, `[class*="hero"] p`) and excludes any ancestor matching a review-section pattern (Okendo, Yotpo, Loox, etc.). Do NOT expand to `body` or `*` — review text, customer names, and foreign-language UGC cause a noise storm (verified: 20k raw bugs run 1, 10k run 2 before fix). `data/brand-dictionary.txt` holds ~100 wellness/supplement/brand terms; add product-specific vocabulary there before a new run.
- **`cspell.json` tuning** — `minWordLength: 5` prevents short words from triggering; `ignoreRegExpList` covers accented characters so Spanish words without diacritics (e.g., "gracias") are not flagged.
- **`image.ts` is the only DOM-walk check on every URL** — runs after `runSeoCheck` in `crawl.spec.ts`. It deliberately uses string-form `page.evaluate(\`(function(){...})()\`)` instead of arrow-function form because tsx-transpiled closures inject `__name` helpers that don't exist in the browser context (`ReferenceError: __name is not defined`). If you add another DOM-walk check, use the same string form. De-dupes within `<picture>` so three broken `<source>` entries inside one element produce one bug, not three.
