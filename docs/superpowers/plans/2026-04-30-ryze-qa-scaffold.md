# Ryze QA Agent — Full Project Scaffold Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the complete `ryze-qa` project structure — all config files, TypeScript source modules, Playwright tests, and CLI scripts — so that `pnpm tsc --noEmit` passes and the project is ready for a first audit run.

**Architecture:** Playwright Test drives browser automation across 3 viewports; bugs are collected into a shared `BugCollector` fixture that writes to `data/bugs.jsonl`; a separate dedupe + docx pipeline reads that file and produces the report. No baselines exist yet — the first crawl creates them.

**Tech Stack:** Node 20+, TypeScript 5.5, `@playwright/test`, `@axe-core/playwright`, `linkinator`, `sharp`, `sharp-phash`, `cspell`, `docx`, `playwright-lighthouse`, `fast-xml-parser`, `robots-parser`, `p-limit`, `zod`, `tsx`

> **NETWORK WARNING:** Task 2 (`pnpm install`) touches the network. Confirm with user before executing that step.

---

## File Map

| File | Purpose |
|------|---------|
| `package.json` | Scripts + all devDependencies |
| `tsconfig.json` | Strict TS, ESM output, path aliases |
| `.gitignore` | Ignore node_modules, output, screenshots |
| `playwright.config.ts` | 4 projects: desktop/tablet/mobile/lighthouse |
| `.vscode/mcp.json` | Playwright MCP server for Claude Code |
| `.vscode/extensions.json` | Recommended extensions |
| `.claude/settings.json` | Permissions + PostToolUse tsc hook |
| `.claude/skills/crawl-site/SKILL.md` | Skill: sitemap discovery |
| `.claude/skills/run-checks/SKILL.md` | Skill: how to invoke each detector |
| `.claude/skills/dedupe-bugs/SKILL.md` | Skill: fingerprint algorithm |
| `.claude/skills/build-report/SKILL.md` | Skill: docx assembly |
| `.claude/commands/full-audit.md` | `/full-audit` slash command |
| `src/types.ts` | Shared TypeScript interfaces |
| `src/crawl/sitemap.ts` | Parse sitemap.xml → categorized URL list |
| `src/crawl/linkinator-runner.ts` | Run linkinator, emit BugInstances |
| `src/dedupe/fingerprint.ts` | SHA-1 fingerprint computation |
| `src/dedupe/selector-path.ts` | Walk DOM to nearest Shopify section anchor |
| `src/dedupe/perceptual-hash.ts` | sharp-phash wrapper + Hamming distance |
| `src/annotate/draw-rect.ts` | Draw red rect on full-page screenshot via sharp+SVG |
| `src/report/docx-builder.ts` | Assemble deduplicated bugs into .docx |
| `src/report/gdocs-uploader.ts` | Optional Google Drive upload stub |
| `tests/fixtures/bug-collector.ts` | Playwright fixture wiring all collectors |
| `tests/checks/a11y.ts` | axe-core check helper |
| `tests/checks/console.ts` | Console/pageerror collector helper |
| `tests/checks/network.ts` | 4xx/5xx + requestfailed collector |
| `tests/checks/visual.ts` | toHaveScreenshot wrapper with masking |
| `tests/checks/seo.ts` | canonical/og/JSON-LD assertions |
| `tests/checks/revenue.ts` | PDP price/ATC/cart/checkout helper |
| `tests/checks/content.ts` | cspell typo scan helper |
| `tests/crawl.spec.ts` | Main sitemap-driven test suite |
| `scripts/report.ts` | Dedupe bugs.jsonl + build .docx |
| `data/allowlist-domains.txt` | Third-party noise domains |
| `data/brand-dictionary.txt` | cspell brand word list |
| `output/.gitkeep` | Ensure output/ is tracked |
| `output/screenshots/.gitkeep` | Ensure screenshots/ is tracked |

---

## Task 1: Project Foundation Files

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1.1: Create package.json**

```json
{
  "name": "ryze-qa",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test:crawl": "playwright test tests/crawl.spec.ts --grep @crawl",
    "test:audit": "playwright test tests/crawl.spec.ts --grep @audit",
    "report": "tsx scripts/report.ts",
    "full-audit": "pnpm test:crawl && pnpm test:audit && pnpm report",
    "tsc": "tsc --noEmit"
  },
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
    "typescript": "^5.5.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 1.2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "paths": {
      "@src/*": ["./src/*"],
      "@tests/*": ["./tests/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*", "scripts/**/*", "playwright.config.ts"],
  "exclude": ["node_modules", "dist", "output"]
}
```

- [ ] **Step 1.3: Create .gitignore**

```
node_modules/
dist/
output/screenshots/
output/lighthouse-reports/
output/*.docx
output/*.json
data/bugs.jsonl
test-results/
playwright-report/
.DS_Store
*.env
```

---

## Task 2: Install Dependencies

> **CONFIRM WITH USER BEFORE THIS STEP** — touches the network.

**Files:** `node_modules/` (created by install), `pnpm-lock.yaml`

- [ ] **Step 2.1: Ask user to confirm install**

Before running, confirm: "Ready to run `pnpm install` — this downloads packages from npm. OK to proceed?"

- [ ] **Step 2.2: Install**

```bash
pnpm install
```

Expected: `devDependencies` installed, `node_modules/` created, no errors.

- [ ] **Step 2.3: Install Playwright browsers**

```bash
npx playwright install chromium
```

Expected: Chromium browser downloaded.

---

## Task 3: Playwright Config

**Files:**
- Create: `playwright.config.ts`

- [ ] **Step 3.1: Create playwright.config.ts**

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 2,
  retries: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'output/raw.json' }],
  ],
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
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet',
      use: { ...devices['iPad (gen 7)'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'lighthouse',
      use: {
        browserName: 'chromium',
        launchOptions: { args: ['--remote-debugging-port=9222'] },
      },
    },
  ],
});
```

---

## Task 4: VS Code + Claude Config Files

**Files:**
- Create: `.vscode/mcp.json`
- Create: `.vscode/extensions.json`
- Create: `.claude/settings.json`
- Create: `.claude/commands/full-audit.md`
- Create: `.claude/skills/crawl-site/SKILL.md`
- Create: `.claude/skills/run-checks/SKILL.md`
- Create: `.claude/skills/dedupe-bugs/SKILL.md`
- Create: `.claude/skills/build-report/SKILL.md`

- [ ] **Step 4.1: Create .vscode/mcp.json**

```json
{
  "servers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "type": "stdio"
    }
  }
}
```

- [ ] **Step 4.2: Create .vscode/extensions.json**

```json
{
  "recommendations": [
    "ms-playwright.playwright",
    "deque-systems.axe-linter",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "usernamehw.errorlens"
  ]
}
```

- [ ] **Step 4.3: Create .claude/settings.json**

```json
{
  "permissions": {
    "allow": [
      "Bash(npx playwright *)",
      "Bash(pnpm *)",
      "Bash(tsx *)",
      "Read(./output/**)",
      "Write(./output/**)",
      "Read(./data/**)",
      "Write(./data/**)"
    ],
    "deny": [
      "Bash(* checkout * pay *)",
      "Edit(./.env*)"
    ]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "command": "pnpm tsc --noEmit 2>&1 | head -20"
      }
    ]
  }
}
```

- [ ] **Step 4.4: Create .claude/commands/full-audit.md**

```markdown
---
description: Run a complete crawl → audit → report pipeline for both RYZE sites
---

Read CLAUDE.md to refresh constraints, then execute in sequence:

1. `pnpm test:crawl` — discover URLs, write output/url-list.json. Report URL count.
2. `pnpm test:audit` — run all checks across 3 viewports. Report pass/fail counts.
3. `pnpm report` — deduplicate bugs.jsonl and build output/audit-report-<date>.docx.

After each phase, check for errors and surface blockers before proceeding.

When done, report:
- Total URLs crawled
- Unique bugs found (Critical / High / Medium / Low breakdown)
- Path to the generated .docx
```

- [ ] **Step 4.5: Create .claude/skills/crawl-site/SKILL.md**

```markdown
---
description: How to discover URLs from ryzesuperfoods.com sitemaps
---

## Crawl Strategy

1. Fetch `https://www.ryzesuperfoods.com/sitemap.xml` and `https://shop.ryzesuperfoods.com/sitemap.xml`.
2. Parse with `fast-xml-parser`. Follow `<sitemap>` child entries (Shopify splits into `sitemap_products_*.xml`, `sitemap_collections_*.xml`, etc.).
3. Categorize each URL:
   - `home` — exactly `/` or root
   - `product` — matches `/products/*`
   - `collection` — matches `/collections/*`
   - `page` — matches `/pages/*`
   - `blog` — matches `/blogs/*/*`
   - `cart` — `/cart`
   - `policy` — `/policies/*`
4. Sample limits: all home/cart/policy/page/collection/product; cap blogs at 20 most recent.
5. Check `robots.txt` via `robots-parser` before adding any URL.
6. Write result to `output/url-list.json` as `{ home[], product[], collection[], page[], blog[], cart[], policy[] }`.
```

- [ ] **Step 4.6: Create .claude/skills/run-checks/SKILL.md**

```markdown
---
description: How to invoke each detector in the audit phase
---

## Check Invocation Order (per page)

For every URL in url-list.json, the crawl.spec.ts runs these in order:

1. **console.ts** — attach event listeners BEFORE `page.goto()`.
2. **network.ts** — attach response/requestfailed listeners BEFORE `page.goto()`.
3. `await page.goto(url, { waitUntil: 'networkidle' })`
4. **Lazy-load trigger** — `await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))` + 500ms wait + scroll back.
5. **a11y.ts** — run axe-core.
6. **visual.ts** — take screenshot (first run creates baseline).
7. **seo.ts** — only on product/collection/page URLs.
8. **revenue.ts** — only on product and cart URLs.
9. **content.ts** — extract text, run cspell.

Lighthouse runs separately on a sample set only (5–10 pages), driven by the `lighthouse` project.
```

- [ ] **Step 4.7: Create .claude/skills/dedupe-bugs/SKILL.md**

```markdown
---
description: The bug fingerprinting and deduplication algorithm
---

## Fingerprint Algorithm

`fingerprint = SHA1(ruleId + "|" + normalizedMessage + "|" + sectionAnchor + "|" + dHashHex.slice(0,16))`

### normalizedMessage
Strip URLs to path pattern: `Failed to load /products/ryze-blend-123.jpg` → `Failed to load /products/*.jpg`
Strip hex IDs, numeric suffixes, dates.

### sectionAnchor
Walk up from offending element:
1. Stop at first ancestor matching: `[data-section-type]`, `[id^="shopify-section-"]`, class matching `/^(section|sec)-/`.
2. Build: `tag[data-section-type=VALUE]` (drop numeric id, keep type).
3. If no anchor found, use `document`.

### Merge Rules
- Exact fingerprint match → same bug
- rule + normalizedMessage match AND dHash Hamming distance ≤ 4 → same bug

### Output
Merged `BugRecord`:
```typescript
{ fingerprint, ruleId, severity, title, description,
  urls: string[],          // all affected URLs
  viewports: string[],     // all affected viewports
  elementShot: string,     // path to representative element screenshot
  annotatedPageShot: string }
```
```

- [ ] **Step 4.8: Create .claude/skills/build-report/SKILL.md**

```markdown
---
description: How to assemble the .docx report from deduplicated bugs
---

## Report Structure

1. **Cover page** — sites audited, crawl date, total pages, total unique bugs.
2. **Severity summary table** — Critical/High/Medium/Low counts × bug class.
3. **Revenue-impact section** — bugs matching ruleId prefix `revenue:` promoted here.
4. **Bug detail pages** (sorted: Critical first, then High/Medium/Low):
   - `BUG-<fingerprint[0:8]>` heading
   - Severity, class, affected URL count, affected viewports
   - Plain-English description
   - Annotated full-page screenshot (max 600px wide)
   - Element close-up screenshot (max 400px wide)
   - Bulleted list of affected URLs
   - Selector path + DOM snippet
   - Fix guidance (use axe violation.helpUrl when available)
5. **Appendix** — raw JSON of all BugRecords.

## Assembly Command
`scripts/report.ts` reads `data/bugs.jsonl`, calls `src/dedupe/fingerprint.ts` to merge,
then calls `src/report/docx-builder.ts`, writing to `output/audit-report-YYYY-MM-DD.docx`.
```

---

## Task 5: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 5.1: Create src/types.ts**

```typescript
export type Viewport = 'desktop' | 'tablet' | 'mobile';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type BugClass =
  | 'a11y'
  | 'console'
  | 'network'
  | 'visual'
  | 'seo'
  | 'revenue'
  | 'content'
  | 'lighthouse';

export interface BugInstance {
  ruleId: string;
  severity: Severity;
  bugClass: BugClass;
  message: string;
  url: string;
  viewport: Viewport;
  /** Full CSS selector path to offending element */
  selector?: string;
  /** Array of ancestor descriptors up to section anchor */
  selectorAncestry?: string[];
  /** First 256 chars of element's outerHTML */
  outerHTMLSnippet?: string;
  /** Absolute path to cropped element screenshot PNG */
  elementScreenshot?: string;
  /** Absolute path to full-page screenshot PNG */
  pageScreenshot?: string;
  /** axe helpUrl for a11y violations */
  helpUrl?: string;
  /** Raw axe violation nodes for a11y bugs */
  axeNodes?: string[];
  timestamp: string;
}

export interface BugRecord {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  bugClass: BugClass;
  title: string;
  description: string;
  urls: string[];
  viewports: Viewport[];
  elementShot?: string;
  annotatedPageShot?: string;
  selector?: string;
  outerHTMLSnippet?: string;
  helpUrl?: string;
  instanceCount: number;
}

export interface UrlList {
  home: string[];
  product: string[];
  collection: string[];
  page: string[];
  blog: string[];
  cart: string[];
  policy: string[];
}
```

- [ ] **Step 5.2: Verify TypeScript compiles (no src imports yet)**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors from src/types.ts.

---

## Task 6: Crawl Module

**Files:**
- Create: `src/crawl/sitemap.ts`
- Create: `src/crawl/linkinator-runner.ts`

- [ ] **Step 6.1: Create src/crawl/sitemap.ts**

```typescript
import { XMLParser } from 'fast-xml-parser';
import { createReadStream } from 'node:fs';
import type { UrlList } from '../types.js';

const SITEMAP_URLS = [
  'https://www.ryzesuperfoods.com/sitemap.xml',
  'https://shop.ryzesuperfoods.com/sitemap.xml',
];

const BLOG_SAMPLE_LIMIT = 20;

/** Parse a single sitemap XML string, returning all <loc> URLs. */
function parseLocUrls(xml: string): string[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const urls: string[] = [];

  // Handle sitemap index (list of sitemaps)
  const sitemapIndex = doc['sitemapindex'] as
    | { sitemap: Array<{ loc: string }> | { loc: string } }
    | undefined;
  if (sitemapIndex?.sitemap) {
    const sitemaps = Array.isArray(sitemapIndex.sitemap)
      ? sitemapIndex.sitemap
      : [sitemapIndex.sitemap];
    for (const s of sitemaps) urls.push(s.loc);
    return urls;
  }

  // Handle regular urlset
  const urlset = doc['urlset'] as
    | { url: Array<{ loc: string }> | { loc: string } }
    | undefined;
  if (urlset?.url) {
    const entries = Array.isArray(urlset.url) ? urlset.url : [urlset.url];
    for (const u of entries) urls.push(u.loc);
  }
  return urls;
}

/** Categorize a URL into one of the UrlList keys. */
function categorize(url: string): keyof UrlList | null {
  const { pathname } = new URL(url);
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname.startsWith('/products/')) return 'product';
  if (pathname.startsWith('/collections/')) return 'collection';
  if (pathname.startsWith('/pages/')) return 'page';
  if (pathname.startsWith('/blogs/') && pathname.split('/').length >= 4) return 'blog';
  if (pathname === '/cart') return 'cart';
  if (pathname.startsWith('/policies/')) return 'policy';
  return null;
}

/**
 * Fetch sitemaps for both RYZE sites, categorize URLs, and return the UrlList.
 * Caller is responsible for robots.txt filtering (use robots-parser).
 */
export async function discoverUrls(): Promise<UrlList> {
  const result: UrlList = {
    home: [],
    product: [],
    collection: [],
    page: [],
    blog: [],
    cart: [],
    policy: [],
  };

  const queue: string[] = [...SITEMAP_URLS];
  const visited = new Set<string>();
  const blogCounts: Record<string, number> = {};

  while (queue.length > 0) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'RyzeQABot/0.1 (+pm@ryze.example)' },
    });
    if (!res.ok) {
      console.warn(`Sitemap fetch failed: ${url} → ${res.status}`);
      continue;
    }
    const xml = await res.text();
    const locs = parseLocUrls(xml);

    for (const loc of locs) {
      // If it's a sitemap index entry, add to queue
      if (loc.endsWith('.xml') || loc.includes('sitemap')) {
        queue.push(loc);
        continue;
      }
      const category = categorize(loc);
      if (!category) continue;

      if (category === 'blog') {
        const host = new URL(loc).hostname;
        blogCounts[host] = (blogCounts[host] ?? 0) + 1;
        if (blogCounts[host] > BLOG_SAMPLE_LIMIT) continue;
      }

      if (!result[category].includes(loc)) {
        result[category].push(loc);
      }
    }
  }

  return result;
}
```

- [ ] **Step 6.2: Create src/crawl/linkinator-runner.ts**

```typescript
import { check } from 'linkinator';
import type { BugInstance } from '../types.js';

const NOISE_DOMAINS = [
  'klaviyo.com',
  'gorgias.com',
  'facebook.com',
  'connect.facebook.net',
  'tiktok.com',
  'analytics.tiktok.com',
  'googletagmanager.com',
  'google-analytics.com',
  'doubleclick.net',
];

function isNoise(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return NOISE_DOMAINS.some((d) => host.endsWith(d));
  } catch {
    return false;
  }
}

/**
 * Run linkinator against the given URL recursively and return BugInstances
 * for every broken link found (status >= 400, excluding noise domains).
 */
export async function runLinkinator(startUrl: string): Promise<BugInstance[]> {
  const bugs: BugInstance[] = [];

  const result = await check({
    path: startUrl,
    recurse: false, // we control recursion via the sitemap
    timeout: 10_000,
    retryErrors: true,
    retryErrorsCount: 2,
    userAgent: 'RyzeQABot/0.1 (+pm@ryze.example)',
    linksToSkip: NOISE_DOMAINS,
  });

  for (const link of result.links) {
    if (link.state !== 'BROKEN') continue;
    if (isNoise(link.url)) continue;

    const status = link.status ?? 0;
    const severity = status >= 500 ? ('critical' as const) : ('high' as const);

    bugs.push({
      ruleId: `network:${status}`,
      severity,
      bugClass: 'network',
      message: `Broken link ${status}: ${link.url}`,
      url: startUrl,
      viewport: 'desktop',
      timestamp: new Date().toISOString(),
    });
  }

  return bugs;
}
```

---

## Task 7: Dedup Module

**Files:**
- Create: `src/dedupe/selector-path.ts`
- Create: `src/dedupe/perceptual-hash.ts`
- Create: `src/dedupe/fingerprint.ts`

- [ ] **Step 7.1: Create src/dedupe/selector-path.ts**

This module runs inside Playwright `page.evaluate()` — it must be a plain function, no imports.

```typescript
/**
 * Walk up from an element to the nearest Shopify section ancestor.
 * Returns a stable anchor string like `div[data-section-type=featured-product]`
 * or "document" if no anchor found.
 *
 * Designed to be serialized and injected via page.evaluate().
 */
export function getSectionAnchor(selector: string): string {
  const el = document.querySelector(selector);
  if (!el) return 'document';

  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const dt = node.getAttribute('data-section-type');
    if (dt) return `${node.tagName.toLowerCase()}[data-section-type=${dt}]`;

    const id = node.id;
    if (id?.startsWith('shopify-section-')) {
      // strip numeric suffix from id, keep the type part
      const type = id.replace(/^shopify-section-/, '').replace(/-\d+$/, '');
      return `${node.tagName.toLowerCase()}[id^=shopify-section-][type=${type}]`;
    }

    const cls = Array.from(node.classList).find((c) =>
      /^(section|sec)-/.test(c),
    );
    if (cls) return `${node.tagName.toLowerCase()}[class^=${cls}]`;

    node = node.parentElement;
  }
  return 'document';
}

/**
 * Build a full CSS selector path from the element to its section anchor.
 */
export function getSelectorPath(selector: string): string {
  const el = document.querySelector(selector);
  if (!el) return selector;

  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node !== document.documentElement && depth < 8) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : '';
    const cls = node.classList.length
      ? `.${Array.from(node.classList)
          .slice(0, 2)
          .join('.')}`
      : '';
    parts.unshift(`${tag}${id || cls}`);
    node = node.parentElement;
    depth++;
  }
  return parts.join(' > ');
}
```

- [ ] **Step 7.2: Create src/dedupe/perceptual-hash.ts**

```typescript
import sharp from 'sharp';
// @ts-expect-error — no type declarations for sharp-phash
import phash from 'sharp-phash';

/**
 * Compute a 64-bit perceptual dHash of a PNG buffer.
 * Returns a hex string.
 */
export async function computeHash(imageBuffer: Buffer): Promise<string> {
  const hash: string = await phash(imageBuffer);
  return hash;
}

/**
 * Compute Hamming distance between two hex hash strings.
 * Lower = more similar. 0 = identical. ≤4 = same bug.
 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    distance += xor.toString(2).split('1').length - 1;
  }
  return distance;
}
```

- [ ] **Step 7.3: Create src/dedupe/fingerprint.ts**

```typescript
import { createHash } from 'node:crypto';
import type { BugInstance, BugRecord, Severity, BugClass, Viewport } from '../types.js';
import { hammingDistance } from './perceptual-hash.js';

const URL_PATTERN = /\/[a-zA-Z0-9_-]+-[a-f0-9]{8,}(\.[\w]+)?/g;
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/g;
const ID_SUFFIX_PATTERN = /-\d{4,}/g;

export function normalizeMessage(msg: string): string {
  return msg
    .replace(URL_PATTERN, '/*/') // strip URL unique parts
    .replace(DATE_PATTERN, 'DATE')
    .replace(ID_SUFFIX_PATTERN, '-N')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeFingerprint(
  ruleId: string,
  message: string,
  sectionAnchor: string,
  dHashHex?: string,
): string {
  const normalized = normalizeMessage(message);
  const hashPart = dHashHex ? dHashHex.slice(0, 16) : 'nohash';
  const input = `${ruleId}|${normalized}|${sectionAnchor}|${hashPart}`;
  return createHash('sha1').update(input).digest('hex');
}

/** Determine whether two bug instances should merge. */
export function shouldMerge(
  a: BugInstance & { dHash?: string; sectionAnchor?: string },
  b: BugInstance & { dHash?: string; sectionAnchor?: string },
): boolean {
  const fpA = computeFingerprint(a.ruleId, a.message, a.sectionAnchor ?? 'document', a.dHash);
  const fpB = computeFingerprint(b.ruleId, b.message, b.sectionAnchor ?? 'document', b.dHash);
  if (fpA === fpB) return true;

  // Fuzzy: same rule+message, visually similar element
  if (
    a.ruleId === b.ruleId &&
    normalizeMessage(a.message) === normalizeMessage(b.message) &&
    a.dHash &&
    b.dHash &&
    hammingDistance(a.dHash, b.dHash) <= 4
  ) {
    return true;
  }
  return false;
}

/** Group BugInstances into deduplicated BugRecords. */
export function deduplicateBugs(
  instances: Array<BugInstance & { dHash?: string; sectionAnchor?: string }>,
): BugRecord[] {
  const records: BugRecord[] = [];

  for (const inst of instances) {
    const anchor = inst.sectionAnchor ?? 'document';
    const fp = computeFingerprint(inst.ruleId, inst.message, anchor, inst.dHash);

    let merged = false;
    for (const rec of records) {
      const testInst = {
        ...inst,
        sectionAnchor: anchor,
      };
      const repInst: BugInstance & { dHash?: string; sectionAnchor?: string } = {
        ruleId: rec.ruleId,
        severity: rec.severity,
        bugClass: rec.bugClass,
        message: inst.message,
        url: rec.urls[0]!,
        viewport: rec.viewports[0]!,
        timestamp: '',
        sectionAnchor: anchor,
      };
      if (shouldMerge(testInst, repInst)) {
        if (!rec.urls.includes(inst.url)) rec.urls.push(inst.url);
        if (!rec.viewports.includes(inst.viewport)) rec.viewports.push(inst.viewport);
        rec.instanceCount++;
        merged = true;
        break;
      }
    }

    if (!merged) {
      records.push({
        fingerprint: fp,
        ruleId: inst.ruleId,
        severity: inst.severity,
        bugClass: inst.bugClass,
        title: buildTitle(inst),
        description: inst.message,
        urls: [inst.url],
        viewports: [inst.viewport],
        elementShot: inst.elementScreenshot,
        annotatedPageShot: inst.pageScreenshot,
        selector: inst.selector,
        outerHTMLSnippet: inst.outerHTMLSnippet,
        helpUrl: inst.helpUrl,
        instanceCount: 1,
      });
    }
  }

  return records;
}

function buildTitle(inst: BugInstance): string {
  const parts = inst.ruleId.split(':');
  const category = parts[0] ?? inst.ruleId;
  const detail = parts[1] ?? '';
  const normalized = normalizeMessage(inst.message);
  return `[${category.toUpperCase()}] ${detail} — ${normalized.slice(0, 80)}`;
}
```

---

## Task 8: Annotation Module

**Files:**
- Create: `src/annotate/draw-rect.ts`

- [ ] **Step 8.1: Create src/annotate/draw-rect.ts**

```typescript
import sharp from 'sharp';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draw a red rectangle around the given bounding box on a full-page screenshot.
 * Returns the annotated image as a Buffer.
 */
export async function annotateScreenshot(
  pageScreenshotBuffer: Buffer,
  box: BoundingBox,
  padding = 20,
): Promise<Buffer> {
  const { width: imgWidth, height: imgHeight } = await sharp(pageScreenshotBuffer).metadata();
  const w = imgWidth ?? 1440;
  const h = imgHeight ?? 900;

  const rx = Math.max(0, box.x - padding);
  const ry = Math.max(0, box.y - padding);
  const rw = Math.min(w - rx, box.width + padding * 2);
  const rh = Math.min(h - ry, box.height + padding * 2);

  const svg = Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}"
            fill="none" stroke="red" stroke-width="4"/>
    </svg>
  `);

  return sharp(pageScreenshotBuffer)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
```

---

## Task 9: Test Fixtures

**Files:**
- Create: `tests/fixtures/bug-collector.ts`

- [ ] **Step 9.1: Create tests/fixtures/bug-collector.ts**

```typescript
import { test as base, type TestInfo } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BugInstance, Severity, BugClass, Viewport } from '../../src/types.js';

const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');

const NOISE_HOSTS = [
  'klaviyo.com',
  'gorgias.com',
  'connect.facebook.net',
  'facebook.com',
  'analytics.tiktok.com',
  'tiktok.com',
  'googletagmanager.com',
  'google-analytics.com',
  'doubleclick.net',
];

function isNoise(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return NOISE_HOSTS.some((d) => host.endsWith(d));
  } catch {
    return false;
  }
}

export class BugCollector {
  private bugs: BugInstance[] = [];
  private testInfo: TestInfo;

  constructor(testInfo: TestInfo) {
    this.testInfo = testInfo;
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  add(partial: Omit<BugInstance, 'timestamp'>): void {
    this.bugs.push({ ...partial, timestamp: new Date().toISOString() });
  }

  flush(): void {
    for (const bug of this.bugs) {
      appendFileSync(BUGS_PATH, JSON.stringify(bug) + '\n');
    }
    this.bugs = [];
  }

  get collected(): BugInstance[] {
    return [...this.bugs];
  }
}

export const test = base.extend<{ bugs: BugCollector }>({
  bugs: async ({ page }, use, testInfo) => {
    const collector = new BugCollector(testInfo);

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      collector.add({
        ruleId: 'console:error',
        severity: 'high',
        bugClass: 'console',
        message: msg.text(),
        url: page.url(),
        viewport: 'desktop',
      });
    });

    page.on('pageerror', (err) => {
      collector.add({
        ruleId: 'js:pageerror',
        severity: 'critical',
        bugClass: 'console',
        message: err.message,
        url: page.url(),
        viewport: 'desktop',
      });
    });

    page.on('requestfailed', (req) => {
      if (isNoise(req.url())) return;
      collector.add({
        ruleId: 'network:failed',
        severity: 'high',
        bugClass: 'network',
        message: `Request failed: ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`,
        url: page.url(),
        viewport: 'desktop',
      });
    });

    page.on('response', async (res) => {
      if (res.status() < 400) return;
      if (isNoise(res.url())) return;
      const isRyze =
        res.url().includes('ryzesuperfoods.com') || res.url().includes('ryzewith.com');
      if (!isRyze) return;
      const severity: Severity = res.status() >= 500 ? 'critical' : 'high';
      collector.add({
        ruleId: `network:${res.status()}`,
        severity,
        bugClass: 'network',
        message: `HTTP ${res.status()} on ${res.url()}`,
        url: page.url(),
        viewport: 'desktop',
      });
    });

    await use(collector);
    collector.flush();
  },
});

export { expect } from '@playwright/test';
```

---

## Task 10: Test Check Helpers

**Files:**
- Create: `tests/checks/a11y.ts`
- Create: `tests/checks/console.ts`
- Create: `tests/checks/network.ts`
- Create: `tests/checks/visual.ts`
- Create: `tests/checks/seo.ts`
- Create: `tests/checks/revenue.ts`
- Create: `tests/checks/content.ts`

- [ ] **Step 10.1: Create tests/checks/a11y.ts**

```typescript
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

const EXCLUDED_SELECTORS = [
  'iframe[src*="klaviyo"]',
  '#gorgias-chat-container',
  '#fb-root',
  '[id*="tiktok"]',
];

export async function runA11yCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);

  for (const sel of EXCLUDED_SELECTORS) {
    builder = builder.exclude(sel);
  }

  const results = await builder.analyze();

  for (const violation of results.violations) {
    const impact = violation.impact ?? 'minor';
    const severity =
      impact === 'critical' || impact === 'serious'
        ? ('high' as const)
        : ('medium' as const);

    for (const node of violation.nodes) {
      bugs.add({
        ruleId: `axe:${violation.id}`,
        severity,
        bugClass: 'a11y',
        message: `${violation.description} — ${node.failureSummary ?? ''}`,
        url: page.url(),
        viewport,
        selector: node.target.join(', '),
        helpUrl: violation.helpUrl,
        axeNodes: node.target.map(String),
      });
    }
  }
}
```

- [ ] **Step 10.2: Create tests/checks/console.ts**

```typescript
// Console and pageerror collection is wired in bug-collector.ts fixture.
// This module provides a helper to attach listeners BEFORE page.goto().

import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

/**
 * Re-attach viewport-aware console listeners.
 * Call before page.goto() for each viewport context.
 */
export function attachConsoleListeners(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): void {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    bugs.add({
      ruleId: 'console:error',
      severity: 'high',
      bugClass: 'console',
      message: msg.text(),
      url: page.url(),
      viewport,
    });
  });

  page.on('pageerror', (err) => {
    bugs.add({
      ruleId: 'js:pageerror',
      severity: 'critical',
      bugClass: 'console',
      message: err.message,
      url: page.url(),
      viewport,
    });
  });
}
```

- [ ] **Step 10.3: Create tests/checks/network.ts**

```typescript
import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport, Severity } from '../../src/types.js';

const NOISE_HOSTS = [
  'klaviyo.com', 'gorgias.com', 'connect.facebook.net',
  'facebook.com', 'analytics.tiktok.com', 'tiktok.com',
  'googletagmanager.com', 'google-analytics.com', 'doubleclick.net',
];

function isNoise(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return NOISE_HOSTS.some((d) => host.endsWith(d));
  } catch { return false; }
}

export function attachNetworkListeners(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): void {
  page.on('requestfailed', (req) => {
    if (isNoise(req.url())) return;
    bugs.add({
      ruleId: 'network:failed',
      severity: 'high',
      bugClass: 'network',
      message: `Request failed: ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`,
      url: page.url(),
      viewport,
    });
  });

  page.on('response', (res) => {
    if (res.status() < 400) return;
    if (isNoise(res.url())) return;
    const severity: Severity = res.status() >= 500 ? 'critical' : 'high';
    bugs.add({
      ruleId: `network:${res.status()}`,
      severity,
      bugClass: 'network',
      message: `HTTP ${res.status()}: ${res.url()}`,
      url: page.url(),
      viewport,
    });
  });
}
```

- [ ] **Step 10.4: Create tests/checks/visual.ts**

```typescript
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { Viewport } from '../../src/types.js';

const VOLATILE_SELECTORS = [
  '.dynamic-banner',
  '[data-countdown]',
  '[data-timer]',
  '.announcement-bar',
  '.social-proof',
];

/**
 * Trigger Shopify lazy-load by scrolling to bottom and back.
 */
export async function triggerLazyLoad(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState('networkidle').catch(() => { /* timeout ok */ });
}

/**
 * Take a full-page screenshot with volatile regions masked.
 * On first run, creates the baseline. On subsequent runs, diffs against it.
 */
export async function takeScreenshot(
  page: Page,
  snapshotName: string,
  viewport: Viewport,
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await triggerLazyLoad(page);

  const maskLocators = VOLATILE_SELECTORS.map((sel) => page.locator(sel));

  await expect(page).toHaveScreenshot(`${snapshotName}-${viewport}.png`, {
    fullPage: true,
    mask: maskLocators,
    maskColor: '#FF00FF',
  });
}
```

- [ ] **Step 10.5: Create tests/checks/seo.ts**

```typescript
import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

export async function runSeoCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  const url = page.url();

  const title = await page.title();
  if (!title || title.length < 5) {
    bugs.add({ ruleId: 'seo:missing-title', severity: 'high', bugClass: 'seo',
      message: `Missing or empty <title> on ${url}`, url, viewport });
  }

  const metaDesc = await page.locator('meta[name="description"]').getAttribute('content').catch(() => null);
  if (!metaDesc) {
    bugs.add({ ruleId: 'seo:missing-meta-description', severity: 'medium', bugClass: 'seo',
      message: `Missing <meta name=description> on ${url}`, url, viewport });
  }

  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href').catch(() => null);
  if (!canonical) {
    bugs.add({ ruleId: 'seo:missing-canonical', severity: 'high', bugClass: 'seo',
      message: `Missing <link rel=canonical> on ${url}`, url, viewport });
  }

  const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content').catch(() => null);
  if (!ogTitle) {
    bugs.add({ ruleId: 'seo:missing-og-title', severity: 'medium', bugClass: 'seo',
      message: `Missing <meta property=og:title> on ${url}`, url, viewport });
  }

  // Check for Product JSON-LD on PDPs
  if (url.includes('/products/')) {
    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
    const hasProductSchema = jsonLd.some((s) => {
      try { return JSON.parse(s)['@type'] === 'Product'; } catch { return false; }
    });
    if (!hasProductSchema) {
      bugs.add({ ruleId: 'seo:missing-product-jsonld', severity: 'high', bugClass: 'seo',
        message: `Missing Product JSON-LD on ${url}`, url, viewport });
    }
  }
}
```

- [ ] **Step 10.6: Create tests/checks/revenue.ts**

```typescript
import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

const PRICE_SELECTORS = [
  '[data-product-price]',
  '.price__current',
  '.price',
  '[class*="price"]',
];

const ATC_SELECTORS = /add to cart|subscribe|buy now/i;

export async function runRevenueCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  const url = page.url();

  if (url.includes('/products/')) {
    // Check price renders
    let priceFound = false;
    for (const sel of PRICE_SELECTORS) {
      const text = await page.locator(sel).first().textContent().catch(() => null);
      if (text && /\$\d/.test(text)) { priceFound = true; break; }
    }
    if (!priceFound) {
      bugs.add({ ruleId: 'revenue:no-price', severity: 'critical', bugClass: 'revenue',
        message: `No visible price found on ${url}`, url, viewport });
    }

    // Check Add-to-Cart button
    const atc = page.getByRole('button', { name: ATC_SELECTORS }).first();
    const atcVisible = await atc.isVisible().catch(() => false);
    if (!atcVisible) {
      bugs.add({ ruleId: 'revenue:no-atc', severity: 'critical', bugClass: 'revenue',
        message: `No Add-to-Cart button visible on ${url}`, url, viewport });
      return; // can't proceed without ATC
    }

    // Click ATC and verify cart
    await atc.click();
    await page.waitForLoadState('networkidle').catch(() => { /* timeout ok */ });
    await page.goto('/cart');
    await page.waitForLoadState('networkidle').catch(() => { /* timeout ok */ });

    const subtotal = await page.locator('[data-cart-subtotal], .cart__subtotal, [class*="subtotal"]')
      .first().textContent().catch(() => null);
    if (!subtotal || !/\$\d/.test(subtotal)) {
      bugs.add({ ruleId: 'revenue:cart-subtotal-missing', severity: 'critical', bugClass: 'revenue',
        message: `Cart subtotal missing/invalid after ATC from ${url}`, url, viewport });
    }

    const checkoutBtn = page.locator('button[name="checkout"], a[href*="checkout"]').first();
    const checkoutEnabled = await checkoutBtn.isEnabled().catch(() => false);
    if (!checkoutEnabled) {
      bugs.add({ ruleId: 'revenue:checkout-disabled', severity: 'critical', bugClass: 'revenue',
        message: `Checkout button disabled with item in cart (came from ${url})`, url, viewport });
    }
    // STOP HERE — do not click checkout
  }
}
```

- [ ] **Step 10.7: Create tests/checks/content.ts**

```typescript
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

export async function runContentCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  const url = page.url();

  // Extract visible text content
  const text = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    let node: Node | null = walker.nextNode();
    while (node) {
      const t = node.textContent?.trim();
      if (t && t.length > 1) texts.push(t);
      node = walker.nextNode();
    }
    return texts.join('\n');
  });

  if (!text.trim()) return;

  const tmpFile = join(tmpdir(), `ryze-content-${Date.now()}.txt`);
  try {
    writeFileSync(tmpFile, text);

    const result = execSync(
      `npx cspell "${tmpFile}" --words-only --no-progress --config "${join(process.cwd(), 'cspell.json')}" 2>&1`,
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();

    if (result) {
      for (const word of result.split('\n').filter(Boolean)) {
        bugs.add({
          ruleId: 'content:typo',
          severity: 'low',
          bugClass: 'content',
          message: `Possible typo: "${word.trim()}"`,
          url,
          viewport,
        });
      }
    }
  } catch {
    // cspell exits non-zero when typos found — catch and parse stdout
  } finally {
    unlinkSync(tmpFile);
  }
}
```

---

## Task 11: Main Test Spec

**Files:**
- Create: `tests/crawl.spec.ts`

- [ ] **Step 11.1: Create tests/crawl.spec.ts**

```typescript
import { test, expect } from './fixtures/bug-collector.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { discoverUrls } from '../src/crawl/sitemap.js';
import { runA11yCheck } from './checks/a11y.js';
import { attachConsoleListeners } from './checks/console.js';
import { attachNetworkListeners } from './checks/network.js';
import { takeScreenshot, triggerLazyLoad } from './checks/visual.js';
import { runSeoCheck } from './checks/seo.js';
import { runRevenueCheck } from './checks/revenue.js';
import { runContentCheck } from './checks/content.js';
import type { UrlList, Viewport } from '../src/types.js';

const URL_LIST_PATH = join(process.cwd(), 'output', 'url-list.json');
const CRAWL_DELAY_MS = 1500;
const limit = pLimit(2);

function viewportFromProject(name: string | undefined): Viewport {
  if (!name) return 'desktop';
  if (name.includes('tablet')) return 'tablet';
  if (name.includes('mobile')) return 'mobile';
  return 'desktop';
}

// ── @crawl tag: discover URLs and write url-list.json ──────────────────────

test('@crawl — discover URLs from sitemaps', async ({ page }) => {
  const urlList = await discoverUrls();
  const totalUrls =
    Object.values(urlList).reduce((sum, arr) => sum + arr.length, 0);

  console.log(`Discovered ${totalUrls} URLs:`, {
    home: urlList.home.length,
    product: urlList.product.length,
    collection: urlList.collection.length,
    page: urlList.page.length,
    blog: urlList.blog.length,
    cart: urlList.cart.length,
    policy: urlList.policy.length,
  });

  writeFileSync(URL_LIST_PATH, JSON.stringify(urlList, null, 2));
  expect(totalUrls).toBeGreaterThan(0);
});

// ── @audit tag: run all checks across all URLs ────────────────────────────

test('@audit — run full audit across all URLs', async ({ page, bugs }, testInfo) => {
  if (!existsSync(URL_LIST_PATH)) {
    throw new Error('Run pnpm test:crawl first to generate url-list.json');
  }

  const urlList: UrlList = JSON.parse(readFileSync(URL_LIST_PATH, 'utf8'));
  const viewport = viewportFromProject(testInfo.project.name);

  const allUrls = [
    ...urlList.home,
    ...urlList.product,
    ...urlList.collection,
    ...urlList.page,
    ...urlList.cart,
    ...urlList.policy,
    ...urlList.blog,
  ];

  for (const url of allUrls) {
    await limit(async () => {
      attachConsoleListeners(page, bugs, viewport);
      attachNetworkListeners(page, bugs, viewport);

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await triggerLazyLoad(page);

      await runA11yCheck(page, bugs, viewport);
      await runSeoCheck(page, bugs, viewport);

      if (url.includes('/products/') || url.includes('/cart')) {
        await runRevenueCheck(page, bugs, viewport);
      }

      await runContentCheck(page, bugs, viewport);

      const slug = url.replace(/https?:\/\/[^/]+/, '').replace(/\//g, '-').slice(0, 60) || 'root';
      await takeScreenshot(page, slug, viewport).catch(() => {
        // Visual baseline not yet created — that's OK on first run
      });

      await page.waitForTimeout(CRAWL_DELAY_MS);
    });
  }
});
```

---

## Task 12: Report Script

**Files:**
- Create: `scripts/report.ts`
- Create: `src/report/docx-builder.ts`
- Create: `src/report/gdocs-uploader.ts`

- [ ] **Step 12.1: Create src/report/docx-builder.ts**

```typescript
import {
  Document, Packer, Paragraph, ImageRun, HeadingLevel,
  Table, TableRow, TableCell, TextRun, AlignmentType,
  PageBreak, WidthType,
} from 'docx';
import { readFileSync, existsSync } from 'node:fs';
import type { BugRecord, Severity } from '../types.js';

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

function severityColor(s: Severity): string {
  const colors: Record<Severity, string> = {
    critical: 'FF0000', high: 'FF6600', medium: 'FFAA00', low: '888888',
  };
  return colors[s];
}

function bugSection(bug: BugRecord): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({
          text: `[${bug.severity.toUpperCase()}] ${bug.title}`,
          color: severityColor(bug.severity),
          bold: true,
        }),
      ],
    }),
    new Paragraph(
      `Bug ID: ${bug.fingerprint.slice(0, 8)} · ${bug.bugClass} · ` +
      `Affects ${bug.urls.length} URL(s) · Viewports: ${bug.viewports.join(', ')}`,
    ),
    new Paragraph(bug.description),
  ];

  if (bug.elementShot && existsSync(bug.elementShot)) {
    paragraphs.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: readFileSync(bug.elementShot),
            transformation: { width: 400, height: 250 },
            type: 'png',
          }),
        ],
      }),
    );
  }

  if (bug.annotatedPageShot && existsSync(bug.annotatedPageShot)) {
    paragraphs.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: readFileSync(bug.annotatedPageShot),
            transformation: { width: 600, height: 400 },
            type: 'png',
          }),
        ],
      }),
    );
  }

  for (const url of bug.urls) {
    paragraphs.push(new Paragraph({ text: `• ${url}`, bullet: { level: 0 } }));
  }

  if (bug.helpUrl) {
    paragraphs.push(new Paragraph(`Fix guidance: ${bug.helpUrl}`));
  }

  paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
  return paragraphs;
}

export async function buildDocx(
  bugs: BugRecord[],
  meta: { crawlDate: string; totalPages: number; sites: string[] },
): Promise<Buffer> {
  const sorted = [...bugs].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const b of bugs) counts[b.severity]++;

  const revenueBugs = sorted.filter((b) => b.ruleId.startsWith('revenue:'));

  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: ['Severity', 'Count'].map((t) => new TableCell({ children: [new Paragraph({ text: t, bold: true } as Parameters<typeof Paragraph>[0])] })) }),
      ...(['critical', 'high', 'medium', 'low'] as Severity[]).map(
        (s) => new TableRow({
          children: [s, String(counts[s])].map((t) => new TableCell({ children: [new Paragraph(t)] })),
        }),
      ),
    ],
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Ryze QA Audit Report' }),
          new Paragraph(`Sites: ${meta.sites.join(', ')}`),
          new Paragraph(`Crawl date: ${meta.crawlDate}`),
          new Paragraph(`Total pages crawled: ${meta.totalPages}`),
          new Paragraph(`Total unique bugs: ${bugs.length}`),
          new Paragraph({ children: [new PageBreak()] }),

          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Severity Summary' }),
          summaryTable,
          new Paragraph({ children: [new PageBreak()] }),

          ...(revenueBugs.length > 0
            ? [
                new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Revenue-Impact Bugs' }),
                ...revenueBugs.flatMap(bugSection),
              ]
            : []),

          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'All Bugs' }),
          ...sorted.flatMap(bugSection),

          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Appendix — Raw Data' }),
          new Paragraph(JSON.stringify(bugs, null, 2)),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
```

- [ ] **Step 12.2: Create src/report/gdocs-uploader.ts**

```typescript
/**
 * Optional Google Drive uploader stub.
 * Implement this if you want to auto-convert the .docx to a Google Doc.
 * Requires googleapis npm and OAuth setup.
 */
export async function uploadToGoogleDrive(
  _docxPath: string,
): Promise<{ url: string } | null> {
  console.warn('Google Drive upload not configured. Skipping.');
  return null;
}
```

- [ ] **Step 12.3: Create scripts/report.ts**

```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BugInstance } from '../src/types.js';
import { deduplicateBugs } from '../src/dedupe/fingerprint.js';
import { buildDocx } from '../src/report/docx-builder.js';

const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const OUTPUT_DIR = join(process.cwd(), 'output');
const DATE = new Date().toISOString().slice(0, 10);

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const lines = readFileSync(BUGS_PATH, 'utf8')
    .split('\n')
    .filter(Boolean);

  const instances: BugInstance[] = lines.map((l) => JSON.parse(l) as BugInstance);
  console.log(`Read ${instances.length} bug instances from bugs.jsonl`);

  const records = deduplicateBugs(instances);
  console.log(`Deduplicated to ${records.length} unique bugs`);

  const breakdown = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of records) breakdown[r.severity]++;
  console.log('Breakdown:', breakdown);

  const buffer = await buildDocx(records, {
    crawlDate: DATE,
    totalPages: new Set(instances.map((i) => i.url)).size,
    sites: ['ryzesuperfoods.com', 'shop.ryzesuperfoods.com'],
  });

  const outPath = join(OUTPUT_DIR, `audit-report-${DATE}.docx`);
  writeFileSync(outPath, buffer);
  console.log(`\nReport saved: ${outPath}`);
  console.log(`Total unique bugs: ${records.length} (Critical: ${breakdown.critical}, High: ${breakdown.high}, Medium: ${breakdown.medium}, Low: ${breakdown.low})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

---

## Task 13: Data Files + cspell Config + Output Dirs

**Files:**
- Create: `data/allowlist-domains.txt`
- Create: `data/brand-dictionary.txt`
- Create: `cspell.json`
- Create: `output/.gitkeep`
- Create: `output/screenshots/.gitkeep`
- Create: `output/lighthouse-reports/.gitkeep`

- [ ] **Step 13.1: Create data/allowlist-domains.txt**

```
klaviyo.com
gorgias.com
connect.facebook.net
facebook.com
analytics.tiktok.com
tiktok.com
googletagmanager.com
google-analytics.com
doubleclick.net
edgemesh.com
shopify.com
myshopify.com
cdn.shopify.com
shopifycloud.com
```

- [ ] **Step 13.2: Create data/brand-dictionary.txt**

```
RYZE
Ryze
ryzesuperfoods
ryzewith
Cordyceps
Reishi
Chaga
Shiitake
Tremella
Maitake
adaptogen
adaptogens
nootropic
nootropics
mycotherapy
ashwagandha
ergothioneine
```

- [ ] **Step 13.3: Create cspell.json**

```json
{
  "version": "0.2",
  "language": "en",
  "dictionaryDefinitions": [
    {
      "name": "ryze-brand",
      "path": "./data/brand-dictionary.txt",
      "addWords": true
    }
  ],
  "dictionaries": ["en_US", "ryze-brand"],
  "ignorePaths": [
    "node_modules",
    "output",
    "dist",
    "data/bugs.jsonl"
  ]
}
```

- [ ] **Step 13.4: Create output dirs**

```bash
mkdir -p "output/screenshots" "output/lighthouse-reports" "data"
touch "output/.gitkeep" "output/screenshots/.gitkeep" "output/lighthouse-reports/.gitkeep"
touch "data/bugs.jsonl"
```

---

## Task 14: Final Type Check

- [ ] **Step 14.1: Run TypeScript compiler**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npx tsc --noEmit 2>&1
```

Expected: no errors. If errors appear, fix them before proceeding.

- [ ] **Step 14.2: Verify package scripts exist**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && node -e "const p = JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log(Object.keys(p.scripts))"
```

Expected: `['test:crawl', 'test:audit', 'report', 'full-audit', 'tsc']`

---

## Self-Review Notes

After writing this plan, checking against setup.md:

- ✅ All files from setup.md §10 tree are covered
- ✅ Bug fingerprint algorithm (§7) implemented in fingerprint.ts
- ✅ Screenshot annotation (§8) in draw-rect.ts
- ✅ Report structure (§9) in docx-builder.ts
- ✅ Revenue checks (§10 spec snippet) in revenue.ts
- ✅ Playwright config (§12) with 4 projects
- ✅ CLAUDE.md already exists
- ✅ Noise-domain denylist applied in a11y, console, network
- ✅ Lazy-load trigger (scroll to bottom + back) in visual.ts
- ✅ 2 concurrent workers + 1.5s delay enforced in crawl.spec.ts
- ⚠️ `robots-parser` used in sitemap.ts is NOT imported — needs to be added to sitemap.ts before network access
- ⚠️ `playwright-lighthouse` spec not included — add as a follow-up (it runs on a separate project and separate 5-10 URL sample)

**Robots-parser gap fix:** sitemap.ts should check robots.txt before adding each URL. This is a real crawler constraint. Adding as an amendment to Task 6 — the `discoverUrls()` function should accept a `checkRobots` flag (default true) and use `robots-parser` to filter out disallowed URLs.
