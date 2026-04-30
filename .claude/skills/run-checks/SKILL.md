---
description: How to invoke each detector in the audit phase
---

## Check Invocation Order (per page)

For every URL in url-list.json, the crawl.spec.ts runs these in order:

1. **console.ts** — attach event listeners BEFORE `page.goto()`.
2. **network.ts** — attach response/requestfailed listeners BEFORE `page.goto()`.
3. `await page.goto(url, { waitUntil: 'networkidle' })`
4. **Lazy-load trigger** — scroll to bottom + 500ms wait + scroll back.
5. **a11y.ts** — run axe-core.
6. **visual.ts** — take screenshot (first run creates baseline).
7. **seo.ts** — only on product/collection/page URLs.
8. **revenue.ts** — only on product and cart URLs.
9. **content.ts** — extract text, run cspell.

Lighthouse runs separately on a sample set only (5-10 pages), driven by the `lighthouse` project.
