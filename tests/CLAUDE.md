# Tests

Playwright test suite across 3 viewports: desktop (1440px), tablet (768px), mobile (390px).

## Key files

| File | Purpose |
|------|---------|
| crawl.spec.ts | Main orchestrator — loops URLs, calls all checks |
| fixtures/bug-collector.ts | Playwright fixture that accumulates bugs into `data/bugs.jsonl` |
| checks/a11y.ts | axe-core WCAG violations |
| checks/console.ts | JS console errors/warnings |
| checks/content.ts | Typos via cspell, broken images |
| checks/network.ts | Nav failures, 4xx/5xx, 429 rate limits |
| checks/revenue.ts | ATC → cart subtotal → checkout button enabled (stop before clicking) |
| checks/seo.ts | Canonical, JSON-LD, meta description presence |
| checks/visual.ts | Screenshot capture per viewport |

## Patterns

- Bug collector appends to `data/bugs.jsonl`; never overwrites. Always `npm run clean` before a fresh audit.
- 3 viewports run via Playwright projects (desktop/tablet/mobile); `lighthouse` project early-returns from `@audit` — it's a no-op for the URL audit.
- ATC flow is wrapped in a 35s `Promise.race` with an `aborted` flag to suppress ghost writes after timeout
- `ATC_SAMPLE_LIMIT = 5` per project — `resetAtcCount()` is called at the start of each `@audit` run so desktop/tablet/mobile each get their own 5-product budget
- `attachConsoleListeners` and `attachNetworkListeners` are called **once before the URL loop** — calling them inside the loop adds duplicate listeners that double-count every bug
- Console errors are captured raw in `checks/console.ts` with no filtering — noise is filtered post-hoc in `scripts/report.ts isNoise()`
- `test.setTimeout(0)` is required on the audit test — 229 URLs × checks would exceed Playwright's default 30s test timeout almost immediately
- `flush()` in `bug-collector.ts` skips when `testInfo.status !== 'passed' && testInfo.retry < testInfo.project.retries` — prevents partial-run data from being written before Playwright retries the test

## Gotchas

- **`toHaveScreenshot()` is banned** — creates baselines on first run, marks test FAILED on any site change. Use `page.screenshot()` with direct file save instead. If stale baselines cause errors, delete `tests/crawl.spec.ts-snapshots/`.
- **ATC button takes 10–15s** — Recharge subscription widget is JS-rendered; wait timeout is 15s. `revenue:no-atc` is noise-filtered in reports (too noisy).
- **Shopify lazy-loads images** — scroll to bottom + back before screenshots to trigger IntersectionObserver.
- **Edgemesh blocks some pages** — Playwright's Chrome gets `ERR_TOO_MANY_REDIRECTS` on `/pages/` and `/blogs/`; wrapped in `navOk` try/catch so one blocked URL doesn't abort the run.
- **ATC flow: always capture `productPageUrl = page.url()` before clicking** — after `atc.click()`, the page may navigate (Recharge redirect). `cartUrl` must be built from the saved URL, not `page.url()` post-click. After `runCartChecks`, navigate back: `await page.goto(productPageUrl)` so `runContentCheck` and `takeScreenshot` run against the product, not `/cart`.
- **`content:typo` check: tmpfiles go in `data/tmp/`** — cspell v8 silently skips files outside its working directory (`os.tmpdir()` returns `/var/folders/…`). Tmpfile must be inside the project root. Also: cspell exits non-zero when typos are found — parse `(err as any).stdout` in the catch block, not the try block return value.
- **`getSectionAnchor()` runs via `page.evaluate()`** — the function uses browser DOM APIs and is serialized + sent to the browser context by Playwright. It has no captured closure variables so serialization is safe. Returns `'document'` as fallback if the element isn't found.
- **`content:typo` first run will be noisy** — cspell was broken for the entire project lifetime before this fix. Expect a volume of typo reports until `data/brand-dictionary.txt` is populated with product/brand terms.
