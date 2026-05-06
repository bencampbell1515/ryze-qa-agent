# Report Redesign — HTML + PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `.docx` report with a self-contained HTML report (two tabs: by severity and by category) and a PDF export of the severity view, with LLM-generated plain-English summaries and cropped element screenshots per finding.

**Architecture:** The orchestrate pipeline gains two new post-scoring steps — summary generation (Sonnet for critical/high/medium, Haiku for low) and category clustering (single Haiku call). The HTML builder reads `summary` and `category` from each `ScoredBug` and produces a fully self-contained single-file HTML document with base64-embedded screenshots. A Playwright-based PDF exporter prints only the severity tab.

**Tech Stack:** TypeScript, Anthropic SDK (already installed), Sharp (already installed), Playwright (already installed), `p-limit` (already installed). Zero new npm dependencies.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types.ts` | Modify | Add `summary?` and `category?` to `ScoredBug` |
| `src/report/styles.ts` | Create | CSS string constant for the HTML report |
| `src/report/screenshot-cropper.ts` | Create | Three-tier screenshot fallback logic |
| `src/report/html-builder.ts` | Create | Builds self-contained HTML report string |
| `src/report/pdf-exporter.ts` | Create | Playwright-based PDF export from HTML file |
| `scripts/summarise.ts` | Create | `generateSummaries()` — LLM summary generation |
| `scripts/categorise.ts` | Create | `assignCategories()` — LLM category clustering |
| `scripts/orchestrate.ts` | Modify | Add steps 10a/10b (summaries + categories) before report build; swap `buildDocx` → `buildHtml` + `exportPdf` |
| `scripts/report.ts` | Modify | Swap `buildDocx` → `buildHtml` + `exportPdf` |
| `tests/unit/html-builder.test.ts` | Create | Unit tests for card rendering, escaping, URL collapsing |
| `tests/unit/screenshot-cropper.test.ts` | Create | Unit tests for tier selection logic |
| `tests/unit/summarise.test.ts` | Create | Unit tests for fallback on API failure |

---

## Task 1: Add `summary` and `category` to `ScoredBug`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add fields to ScoredBug**

Open `src/types.ts`. Find the `ScoredBug` interface (currently ends with `discoveryPersona?: string`). Add two optional fields after `discoveryPersona`:

```ts
/** LLM-generated plain-English 1–2 sentence summary for the report card */
summary?: string;
/** Human-readable category label assigned during orchestrate (e.g. "Sale Pricing") */
category?: string;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add summary and category fields to ScoredBug"
```

---

## Task 2: Summary generation script

**Files:**
- Create: `scripts/summarise.ts`
- Create: `tests/unit/summarise.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/summarise.test.ts`:

```ts
import { test, expect } from '@playwright/test';
import { buildSummaryPrompt, SUMMARY_MODEL } from '../../scripts/summarise.js';
import type { ScoredBug } from '../../src/types.js';

const fakeBug: ScoredBug = {
  fingerprint: 'abc123',
  ruleId: 'revenue:no-atc',
  severity: 'critical',
  bugClass: 'revenue',
  title: 'No ATC button',
  description: 'No Add-to-Cart button visible on product page',
  urls: ['https://www.ryzesuperfoods.com/products/mushroom-coffee'],
  viewports: ['desktop'],
  instanceCount: 1,
  score: 9,
  source: 'playwright',
  confidence: 1.0,
  consensusCount: 1,
};

test('SUMMARY_MODEL returns sonnet for critical', () => {
  expect(SUMMARY_MODEL('critical')).toBe('claude-sonnet-4-6');
});

test('SUMMARY_MODEL returns sonnet for high', () => {
  expect(SUMMARY_MODEL('high')).toBe('claude-sonnet-4-6');
});

test('SUMMARY_MODEL returns sonnet for medium', () => {
  expect(SUMMARY_MODEL('medium')).toBe('claude-sonnet-4-6');
});

test('SUMMARY_MODEL returns haiku for low', () => {
  expect(SUMMARY_MODEL('low')).toBe('claude-haiku-4-5-20251001');
});

test('buildSummaryPrompt includes ruleId and description', () => {
  const prompt = buildSummaryPrompt(fakeBug);
  expect(prompt).toContain('revenue:no-atc');
  expect(prompt).toContain('No Add-to-Cart button visible on product page');
});

test('buildSummaryPrompt includes up to 3 URLs', () => {
  const bug = { ...fakeBug, urls: ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'] };
  const prompt = buildSummaryPrompt(bug);
  expect(prompt).toContain('https://a.com');
  expect(prompt).toContain('https://c.com');
  expect(prompt).not.toContain('https://d.com');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx playwright test tests/unit/summarise.test.ts --reporter=line
```

Expected: FAIL — `summarise.js` does not exist.

- [ ] **Step 3: Create `scripts/summarise.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import type { ScoredBug, Severity } from '../src/types.js';

export function SUMMARY_MODEL(severity: Severity): string {
  return severity === 'low' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
}

export function buildSummaryPrompt(bug: ScoredBug): string {
  const urls = bug.urls.slice(0, 3).join('\n');
  return `You are writing a plain-English bug summary for a non-technical stakeholder report.
Rule: ${bug.ruleId}
Description: ${bug.description}
Affected URLs:
${urls}
Write 1–2 sentences that explain what is wrong and why it matters to a customer or the business.
Be specific — reference the actual content or URL if it helps. Do not use jargon.
Respond with only the summary text, no preamble.`;
}

async function summariseOne(client: Anthropic, bug: ScoredBug): Promise<string> {
  try {
    const response = await client.messages.create({
      model: SUMMARY_MODEL(bug.severity),
      max_tokens: 150,
      messages: [{ role: 'user', content: buildSummaryPrompt(bug) }],
    });
    return (response.content[0] as Anthropic.TextBlock).text.trim();
  } catch {
    return bug.description.slice(0, 200);
  }
}

export async function generateSummaries(
  client: Anthropic,
  bugs: ScoredBug[],
): Promise<ScoredBug[]> {
  const limit = pLimit(10);
  const results = await Promise.all(
    bugs.map((bug) =>
      limit(async () => {
        const summary = await summariseOne(client, bug);
        return { ...bug, summary };
      }),
    ),
  );
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx playwright test tests/unit/summarise.test.ts --reporter=line
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/summarise.ts tests/unit/summarise.test.ts
git commit -m "feat: add summary generation with sonnet/haiku routing"
```

---

## Task 3: Category clustering script

**Files:**
- Create: `scripts/categorise.ts`

- [ ] **Step 1: Write the test**

Add `tests/unit/categorise.test.ts`:

```ts
import { test, expect } from '@playwright/test';
import { fallbackCategory, buildCategoryPrompt } from '../../scripts/categorise.js';

test('fallbackCategory maps revenue rules', () => {
  expect(fallbackCategory('revenue:no-atc')).toBe('Revenue & Checkout');
});

test('fallbackCategory maps axe rules', () => {
  expect(fallbackCategory('axe:color-contrast')).toBe('Accessibility');
});

test('fallbackCategory maps network:404', () => {
  expect(fallbackCategory('network:404')).toBe('Broken Links');
});

test('fallbackCategory maps seo rules', () => {
  expect(fallbackCategory('seo:missing-canonical')).toBe('SEO Tags');
});

test('fallbackCategory maps content rules', () => {
  expect(fallbackCategory('content:typo')).toBe('Content Quality');
});

test('fallbackCategory returns Other for unknown rules', () => {
  expect(fallbackCategory('unknown:thing')).toBe('Other');
});

test('buildCategoryPrompt includes fingerprints and truncated descriptions', () => {
  const findings = [
    { fingerprint: 'fp1', ruleId: 'network:404', description: 'HTTP 404: https://example.com/broken-link' },
  ];
  const prompt = buildCategoryPrompt(findings);
  expect(prompt).toContain('fp1');
  expect(prompt).toContain('network:404');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx playwright test tests/unit/categorise.test.ts --reporter=line
```

Expected: FAIL — `categorise.js` does not exist.

- [ ] **Step 3: Create `scripts/categorise.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { ScoredBug } from '../src/types.js';

export function fallbackCategory(ruleId: string): string {
  if (ruleId.startsWith('revenue:')) return 'Revenue & Checkout';
  if (ruleId.startsWith('axe:')) return 'Accessibility';
  if (ruleId === 'network:404') return 'Broken Links';
  if (ruleId.startsWith('seo:')) return 'SEO Tags';
  if (ruleId.startsWith('content:')) return 'Content Quality';
  return 'Other';
}

export function buildCategoryPrompt(
  findings: { fingerprint: string; ruleId: string; description: string }[],
): string {
  return `You are categorizing QA findings for an e-commerce site audit report.
Assign each finding a short category label (2–4 words) describing the type of problem.
Use consistent labels across similar findings. Be specific — "Sale Pricing" not "Content Issues".
Return JSON only: { "<fingerprint>": "<category>", ... }

Findings:
${JSON.stringify(findings, null, 2)}`;
}

export async function assignCategories(
  client: Anthropic,
  bugs: ScoredBug[],
): Promise<ScoredBug[]> {
  const findings = bugs.map((b) => ({
    fingerprint: b.fingerprint,
    ruleId: b.ruleId,
    description: b.description.slice(0, 120),
  }));

  const categoryMap = new Map<string, string>();

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: buildCategoryPrompt(findings) }],
    });
    const text = (response.content[0] as Anthropic.TextBlock).text.trim();
    const parsed = JSON.parse(text) as Record<string, string>;
    for (const [fp, cat] of Object.entries(parsed)) {
      categoryMap.set(fp, cat);
    }
  } catch {
    // fallback applied below
  }

  return bugs.map((bug) => ({
    ...bug,
    category: categoryMap.get(bug.fingerprint) ?? fallbackCategory(bug.ruleId),
  }));
}
```

- [ ] **Step 4: Run tests**

```bash
npx playwright test tests/unit/categorise.test.ts --reporter=line
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/categorise.ts tests/unit/categorise.test.ts
git commit -m "feat: add category clustering with haiku and fallback map"
```

---

## Task 4: Element screenshot capture in reverify

**Files:**
- Modify: `scripts/reverify.ts`

- [ ] **Step 1: Read the current reverify top-of-loop structure**

Open `scripts/reverify.ts`. Find the `for (const bug of topBugs)` loop. After the `verifyBug()` call that sets `verificationStatus`, add element screenshot capture for bugs with selectors.

- [ ] **Step 2: Add element screenshot capture**

Add this import at the top of `scripts/reverify.ts` (after existing imports):

```ts
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
```

(Note: `join` and `mkdirSync` may already be imported — check and only add what's missing.)

Inside the `for (const bug of topBugs)` loop, after the line that sets `bug.verificationStatus`, add:

```ts
// Capture element screenshot for bugs with a known selector
if (bug.selector) {
  try {
    const el = page.locator(bug.selector).first();
    const visible = await el.isVisible({ timeout: 3_000 }).catch(() => false);
    if (visible) {
      const shotDir = join(process.cwd(), 'output', 'screenshots');
      mkdirSync(shotDir, { recursive: true });
      const shotPath = join(shotDir, `${bug.fingerprint}-element.png`);
      await el.screenshot({ path: shotPath });
      bug.elementShot = shotPath;
    }
  } catch {
    // non-blocking — report build falls back gracefully
  }
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/reverify.ts
git commit -m "feat: capture element screenshot in reverify for bugs with selectors"
```

---

## Task 5: Screenshot cropper utility

**Files:**
- Create: `src/report/screenshot-cropper.ts`
- Create: `tests/unit/screenshot-cropper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/screenshot-cropper.test.ts`:

```ts
import { test, expect } from '@playwright/test';
import { findFullPageShot, urlToSlug } from '../../src/report/screenshot-cropper.js';
import { join } from 'node:path';

test('urlToSlug strips protocol and replaces slashes', () => {
  expect(urlToSlug('https://www.ryzesuperfoods.com/products/mushroom-coffee'))
    .toBe('-products-mushroom-coffee');
});

test('urlToSlug truncates at 60 chars', () => {
  const longPath = '/products/' + 'a'.repeat(80);
  const slug = urlToSlug('https://www.ryzesuperfoods.com' + longPath);
  expect(slug.length).toBeLessThanOrEqual(60);
});

test('findFullPageShot returns null when no screenshots exist', () => {
  const result = findFullPageShot(
    ['https://www.ryzesuperfoods.com/products/does-not-exist'],
    '/tmp/nonexistent-screenshots-dir',
  );
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx playwright test tests/unit/screenshot-cropper.test.ts --reporter=line
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/report/screenshot-cropper.ts`**

```ts
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScoredBug } from '../types.js';

const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');
const DISPLAY_WIDTH = 700;
const CROP_HEIGHT = 700; // top portion of page to crop from full-page shot

export function urlToSlug(url: string): string {
  return url.replace(/https?:\/\/[^/]+/, '').replace(/\//g, '-').slice(0, 60) || 'root';
}

export function findFullPageShot(urls: string[], dir = SCREENSHOTS_DIR): { path: string; viewport: string } | null {
  for (const url of urls.slice(0, 3)) {
    for (const vp of ['desktop', 'tablet', 'mobile']) {
      const p = join(dir, `${urlToSlug(url)}-${vp}.png`);
      if (existsSync(p)) return { path: p, viewport: vp };
    }
  }
  return null;
}

export interface CroppedScreenshot {
  dataUri: string;
  viewport: string;
  tier: 'element' | 'crop' | 'full';
}

export async function getCroppedScreenshot(bug: ScoredBug): Promise<CroppedScreenshot | null> {
  // Tier 1: element screenshot captured during reverify
  if (bug.elementShot && existsSync(bug.elementShot)) {
    try {
      const buf = await sharp(bug.elementShot)
        .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
        .png()
        .toBuffer();
      return {
        dataUri: `data:image/png;base64,${buf.toString('base64')}`,
        viewport: bug.viewports[0] ?? 'desktop',
        tier: 'element',
      };
    } catch { /* fall through */ }
  }

  // Tier 2: crop top portion of full-page screenshot
  const found = findFullPageShot(bug.urls);
  if (found) {
    try {
      const meta = await sharp(found.path).metadata();
      const cropH = Math.min(CROP_HEIGHT, meta.height ?? CROP_HEIGHT);
      const buf = await sharp(found.path)
        .extract({ left: 0, top: 0, width: meta.width ?? 1440, height: cropH })
        .resize({ width: DISPLAY_WIDTH })
        .png()
        .toBuffer();
      return { dataUri: `data:image/png;base64,${buf.toString('base64')}`, viewport: found.viewport, tier: 'crop' };
    } catch { /* fall through */ }

    // Tier 3: full page resized
    try {
      const buf = await sharp(found.path)
        .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
        .png()
        .toBuffer();
      return { dataUri: `data:image/png;base64,${buf.toString('base64')}`, viewport: found.viewport, tier: 'full' };
    } catch { /* fall through */ }
  }

  return null;
}
```

- [ ] **Step 4: Run tests**

```bash
npx playwright test tests/unit/screenshot-cropper.test.ts --reporter=line
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/screenshot-cropper.ts tests/unit/screenshot-cropper.test.ts
git commit -m "feat: add three-tier screenshot cropper (element > crop > full)"
```

---

## Task 6: HTML report styles

**Files:**
- Create: `src/report/styles.ts`

- [ ] **Step 1: Create `src/report/styles.ts`**

```ts
export const STYLES = `
:root {
  --critical: #CC0000;
  --high: #E65C00;
  --medium: #CC8800;
  --low: #666666;
  --brand: #1a3a6b;
  --bg: #f4f4f1;
  --card-bg: #ffffff;
  --border: #e2e8f0;
  --text: #1a1a1a;
  --text-secondary: #666;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.5; }

/* Header */
header { background: var(--brand); color: white; padding: 2rem 2.5rem; }
.brand { font-size: 0.7rem; letter-spacing: 0.25em; text-transform: uppercase; opacity: 0.6; margin-bottom: 0.2rem; }
.report-title { font-size: 1.8rem; font-weight: 700; margin-bottom: 0.2rem; }
.meta { font-size: 0.82rem; opacity: 0.65; margin-bottom: 1.25rem; }
.summary-bar { display: flex; gap: 0.6rem; flex-wrap: wrap; }

/* Badges */
.badge {
  display: inline-flex; align-items: center; padding: 0.28rem 0.7rem;
  border-radius: 999px; font-size: 0.75rem; font-weight: 700;
  color: white; letter-spacing: 0.03em;
}
header .badge { font-size: 0.82rem; padding: 0.35rem 0.85rem; }
.badge.critical { background: var(--critical); }
.badge.high { background: var(--high); }
.badge.medium { background: var(--medium); }
.badge.low { background: var(--low); }

/* Tabs */
.tabs { background: white; border-bottom: 2px solid var(--border); padding: 0 2rem; display: flex; }
.tab {
  background: none; border: none; padding: 0.9rem 1.4rem;
  font-size: 0.88rem; font-weight: 500; cursor: pointer;
  color: var(--text-secondary); border-bottom: 3px solid transparent;
  margin-bottom: -2px; font-family: var(--font);
  transition: color 0.15s, border-color 0.15s;
}
.tab:hover { color: var(--brand); }
.tab.active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }

/* Layout */
main { max-width: 860px; margin: 0 auto; padding: 2rem 1.5rem; }
.view.hidden { display: none; }

/* Severity sections */
.severity-section { margin-bottom: 2.5rem; }
.section-heading { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.6rem; }
.section-heading h2 { font-size: 1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.count { font-size: 0.8rem; color: var(--text-secondary); }
.section-rule { height: 2px; border: none; margin-bottom: 1.1rem; opacity: 0.5; }
.section-rule.critical { background: var(--critical); }
.section-rule.high { background: var(--high); }
.section-rule.medium { background: var(--medium); }
.section-rule.low { background: var(--low); }

/* Category sections */
.category-section { margin-bottom: 2.5rem; }
.category-heading {
  font-size: 1rem; font-weight: 700; color: var(--brand);
  padding-bottom: 0.5rem; margin-bottom: 1rem;
  border-bottom: 2px solid var(--border);
}

/* Finding cards */
.card {
  background: var(--card-bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 1.2rem 1.3rem; margin-bottom: 0.85rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.card-header { display: flex; align-items: center; gap: 0.65rem; margin-bottom: 0.8rem; }
.rule-id {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.78rem; color: var(--text-secondary);
  background: #f0f0ee; padding: 0.15rem 0.45rem; border-radius: 3px;
}
.summary { font-size: 0.93rem; line-height: 1.65; margin-bottom: 1rem; }

/* URLs */
.urls { margin-bottom: 1rem; }
.urls-label {
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--text-secondary); margin-bottom: 0.35rem;
}
.url-list a, .url-overflow a {
  display: block; font-size: 0.8rem; color: #0058cc;
  text-decoration: none; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; padding: 0.08rem 0;
}
.url-list a:hover, .url-overflow a:hover { text-decoration: underline; }
.url-overflow.hidden { display: none; }
.show-more-btn {
  background: none; border: none; color: #0058cc;
  font-size: 0.78rem; cursor: pointer; padding: 0.2rem 0;
  margin-top: 0.15rem; font-family: var(--font);
}
.show-more-btn:hover { text-decoration: underline; }

/* Screenshots */
.screenshot { margin-top: 0.9rem; }
.screenshot img {
  max-width: 100%; border: 1px solid var(--border);
  border-radius: 5px; display: block;
}
figcaption { font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.3rem; }

/* Print / PDF */
@media print {
  .tabs { display: none; }
  .view { display: block !important; }
  #view-category { display: none !important; }
  .url-overflow { display: block !important; }
  .show-more-btn { display: none; }
  .card { break-inside: avoid; }
  body { background: white; }
  header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/report/styles.ts
git commit -m "feat: add HTML report styles"
```

---

## Task 7: HTML builder

**Files:**
- Create: `src/report/html-builder.ts`
- Create: `tests/unit/html-builder.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/html-builder.test.ts`:

```ts
import { test, expect } from '@playwright/test';
import { escapeHtml, urlListHtml } from '../../src/report/html-builder.js';

test('escapeHtml encodes ampersands', () => {
  expect(escapeHtml('a & b')).toBe('a &amp; b');
});

test('escapeHtml encodes angle brackets', () => {
  expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
});

test('escapeHtml encodes double quotes', () => {
  expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
});

test('urlListHtml renders all URLs when 5 or fewer', () => {
  const html = urlListHtml(['https://a.com', 'https://b.com']);
  expect(html).toContain('https://a.com');
  expect(html).toContain('https://b.com');
  expect(html).not.toContain('show-more-btn');
});

test('urlListHtml collapses URLs beyond 5 into overflow', () => {
  const urls = ['https://a.com', 'https://b.com', 'https://c.com',
                'https://d.com', 'https://e.com', 'https://f.com'];
  const html = urlListHtml(urls);
  expect(html).toContain('show-more-btn');
  expect(html).toContain('url-overflow hidden');
  expect(html).toContain('https://f.com');
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx playwright test tests/unit/html-builder.test.ts --reporter=line
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/report/html-builder.ts`**

```ts
import type { ScoredBug, Severity } from '../types.js';
import { getCroppedScreenshot } from './screenshot-cropper.js';
import { STYLES } from './styles.js';

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function urlListHtml(urls: string[]): string {
  const visible = urls.slice(0, 5);
  const overflow = urls.slice(5);

  const renderLinks = (list: string[]) =>
    list.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(u)}</a>`).join('\n');

  if (overflow.length === 0) {
    return `<div class="url-list">${renderLinks(visible)}</div>`;
  }

  return `<div class="url-list">${renderLinks(visible)}</div>
<div class="url-overflow hidden">${renderLinks(overflow)}</div>
<button class="show-more-btn" onclick="toggleMore(this)" data-count="${overflow.length}">+ ${overflow.length} more</button>`;
}

async function cardHtml(bug: ScoredBug): Promise<string> {
  const screenshot = await getCroppedScreenshot(bug);
  const screenshotHtml = screenshot
    ? `<figure class="screenshot">
        <img src="${screenshot.dataUri}" alt="Screenshot showing the bug">
        <figcaption>${escapeHtml(screenshot.viewport)} viewport${screenshot.tier === 'full' ? ' · full page' : ''}</figcaption>
      </figure>`
    : '';

  const summary = escapeHtml(bug.summary ?? bug.description.slice(0, 200));

  return `<div class="card" data-severity="${bug.severity}">
  <div class="card-header">
    <span class="badge ${bug.severity}">${escapeHtml(SEVERITY_LABEL[bug.severity].toUpperCase())}</span>
    <code class="rule-id">${escapeHtml(bug.ruleId)}</code>
  </div>
  <p class="summary">${summary}</p>
  <div class="urls">
    <div class="urls-label">Affected pages (${bug.urls.length})</div>
    ${urlListHtml(bug.urls)}
  </div>
  ${screenshotHtml}
</div>`;
}

async function severityViewHtml(sorted: ScoredBug[]): Promise<string> {
  let html = '';
  for (const sev of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = sorted.filter((b) => b.severity === sev);
    if (group.length === 0) continue;
    const cards = await Promise.all(group.map(cardHtml));
    html += `<div class="severity-section">
  <div class="section-heading">
    <h2 style="color:var(--${sev})">${SEVERITY_LABEL[sev]}</h2>
    <span class="count">${group.length} finding${group.length !== 1 ? 's' : ''}</span>
  </div>
  <hr class="section-rule ${sev}">
  ${cards.join('\n')}
</div>`;
  }
  return html;
}

async function categoryViewHtml(sorted: ScoredBug[]): Promise<string> {
  const map = new Map<string, ScoredBug[]>();
  for (const bug of sorted) {
    const cat = bug.category ?? 'Other';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(bug);
  }

  // Sort categories: worst severity first, then alpha
  const categories = [...map.entries()].sort(([catA, bugsA], [catB, bugsB]) => {
    const worstA = Math.min(...bugsA.map((x) => SEVERITY_ORDER[x.severity]));
    const worstB = Math.min(...bugsB.map((x) => SEVERITY_ORDER[x.severity]));
    return worstA !== worstB ? worstA - worstB : catA.localeCompare(catB);
  });

  let html = '';
  for (const [cat, bugs] of categories) {
    const subSorted = [...bugs].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.score - a.score,
    );
    const cards = await Promise.all(subSorted.map(cardHtml));
    html += `<div class="category-section">
  <h2 class="category-heading">${escapeHtml(cat)} <span class="count">(${bugs.length})</span></h2>
  ${cards.join('\n')}
</div>`;
  }
  return html;
}

const INLINE_JS = `
function showTab(name){
  document.querySelectorAll('.view').forEach(function(v){v.classList.add('hidden');});
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.getElementById('view-'+name).classList.remove('hidden');
  document.getElementById('tab-'+name).classList.add('active');
}
function toggleMore(btn){
  var ov=btn.previousElementSibling;
  var hidden=ov.classList.contains('hidden');
  ov.classList.toggle('hidden');
  btn.textContent=hidden?'− Show fewer':'+ '+btn.dataset.count+' more';
}`;

export async function buildHtml(
  bugs: ScoredBug[],
  meta: { crawlDate: string; totalPages: number; sites: string[] },
): Promise<string> {
  const sorted = [...bugs].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.score - a.score,
  );

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const b of bugs) counts[b.severity]++;

  const [sevView, catView] = await Promise.all([
    severityViewHtml(sorted),
    categoryViewHtml(sorted),
  ]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ryze QA Audit Report — ${escapeHtml(meta.crawlDate)}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <div class="brand">Ryze</div>
  <div class="report-title">QA Audit Report</div>
  <div class="meta">${escapeHtml(meta.crawlDate)} &nbsp;&middot;&nbsp; ${meta.totalPages} pages &nbsp;&middot;&nbsp; ${meta.sites.map(escapeHtml).join(', ')}</div>
  <div class="summary-bar">
    <span class="badge critical">${counts.critical} Critical</span>
    <span class="badge high">${counts.high} High</span>
    <span class="badge medium">${counts.medium} Medium</span>
    <span class="badge low">${counts.low} Low</span>
  </div>
</header>
<div class="tabs">
  <button class="tab active" id="tab-severity" onclick="showTab('severity')">By Severity</button>
  <button class="tab" id="tab-category" onclick="showTab('category')">By Category</button>
</div>
<main>
  <div id="view-severity" class="view">${sevView}</div>
  <div id="view-category" class="view hidden">${catView}</div>
</main>
<script>${INLINE_JS}</script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests**

```bash
npx playwright test tests/unit/html-builder.test.ts --reporter=line
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/report/html-builder.ts tests/unit/html-builder.test.ts
git commit -m "feat: add HTML report builder with severity and category tabs"
```

---

## Task 8: PDF exporter

**Files:**
- Create: `src/report/pdf-exporter.ts`

- [ ] **Step 1: Create `src/report/pdf-exporter.ts`**

```ts
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';

export async function exportPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });

    // Force severity tab, expand all URL overflows, hide interactive chrome for print
    await page.addStyleTag({
      content: `
        .tabs { display: none !important; }
        #view-category { display: none !important; }
        #view-severity { display: block !important; }
        .url-overflow { display: block !important; }
        .show-more-btn { display: none !important; }
      `,
    });

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '1.2cm', bottom: '1.2cm', left: '1.2cm', right: '1.2cm' },
    });
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/report/pdf-exporter.ts
git commit -m "feat: add PDF exporter via Playwright page.pdf()"
```

---

## Task 9: Wire up orchestrate.ts

**Files:**
- Modify: `scripts/orchestrate.ts`

- [ ] **Step 1: Replace docx import with new builders**

At the top of `scripts/orchestrate.ts`, replace:
```ts
import { buildDocx } from '../src/report/docx-builder.js';
```
with:
```ts
import { buildHtml } from '../src/report/html-builder.js';
import { exportPdf } from '../src/report/pdf-exporter.js';
import { generateSummaries } from './summarise.js';
import { assignCategories } from './categorise.js';
```

- [ ] **Step 2: Add Steps 10a and 10b (summaries + categories) before the report build**

Find the existing `// Step 10: Build report` comment. Insert two new steps before it:

```ts
  // Step 10a: Generate plain-English summaries
  console.log('\n✍️  Generating summaries...');
  const withSummaries = await generateSummaries(client, finalScored);

  // Step 10b: Assign categories
  console.log('\n🏷️  Assigning categories...');
  const withCategories = await assignCategories(client, withSummaries);
```

- [ ] **Step 3: Replace the buildDocx call with buildHtml + exportPdf**

Find the existing Step 10 block:
```ts
  // Step 10: Build report
  const buffer = await buildDocx(finalScored, {
    crawlDate: DATE,
    totalPages: new Set(finalScored.flatMap((b) => b.urls)).size,
    sites: ['ryzesuperfoods.com', 'shop.ryzesuperfoods.com'],
  });
  const reportPath = join(OUTPUT_DIR, `audit-report-${DATE}.docx`);
  writeFileSync(reportPath, buffer);
  console.log(`\n📄 Report written to ${reportPath}`);
```

Replace with:
```ts
  // Step 11: Build HTML report
  const reportMeta = {
    crawlDate: DATE,
    totalPages: new Set(withCategories.flatMap((b) => b.urls)).size,
    sites: ['ryzesuperfoods.com', 'shop.ryzesuperfoods.com'],
  };
  const html = await buildHtml(withCategories, reportMeta);
  const htmlPath = join(OUTPUT_DIR, `audit-report-${DATE}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`\n📄 HTML report written to ${htmlPath}`);

  // Step 12: Export PDF
  const pdfPath = join(OUTPUT_DIR, `audit-report-${DATE}.pdf`);
  try {
    await exportPdf(htmlPath, pdfPath);
    console.log(`📄 PDF report written to ${pdfPath}`);
  } catch (err) {
    console.warn('⚠️  PDF export failed — HTML report is still available:', (err as Error).message);
  }
```

Also update the executive summary block below to reference `withCategories` instead of `finalScored`:
- Replace every `finalScored` after the new Step 11 with `withCategories`

- [ ] **Step 4: Add `client` to the `main()` scope**

The `main()` function currently does not instantiate an Anthropic client (that lives inside `validate` and `discover-agentic` scripts). Add it near the top of `main()`:

```ts
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const client = apiKey ? new Anthropic({ apiKey }) : null;
```

Then in Steps 10a and 10b, guard gracefully:

```ts
  // Step 10a: Generate plain-English summaries
  const withSummaries = client
    ? await generateSummaries(client, finalScored)
    : finalScored;

  // Step 10b: Assign categories
  const withCategories = client
    ? await assignCategories(client, withSummaries)
    : withSummaries;
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/orchestrate.ts scripts/summarise.ts scripts/categorise.ts
git commit -m "feat: wire summaries, categories, and HTML/PDF report into orchestrate"
```

---

## Task 10: Update scripts/report.ts

**Files:**
- Modify: `scripts/report.ts`

- [ ] **Step 1: Replace docx import**

At the top of `scripts/report.ts`, replace:
```ts
import { buildDocx } from '../src/report/docx-builder.js';
```
with:
```ts
import { buildHtml } from '../src/report/html-builder.js';
import { exportPdf } from '../src/report/pdf-exporter.js';
```

- [ ] **Step 2: Replace buildDocx call**

Find:
```ts
  const buffer = await buildDocx(records, {
    crawlDate: DATE,
    totalPages,
    sites,
  });
  const outPath = join(OUTPUT_DIR, `audit-report-${DATE}.docx`);
  writeFileSync(outPath, buffer);
  console.log(`Report written to ${outPath}`);
```

Replace with:
```ts
  const html = await buildHtml(records, { crawlDate: DATE, totalPages, sites });
  const htmlPath = join(OUTPUT_DIR, `audit-report-${DATE}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`HTML report written to ${htmlPath}`);

  const pdfPath = join(OUTPUT_DIR, `audit-report-${DATE}.pdf`);
  try {
    await exportPdf(htmlPath, pdfPath);
    console.log(`PDF report written to ${pdfPath}`);
  } catch (err) {
    console.warn('PDF export failed:', (err as Error).message);
  }
```

Note: `records` in `scripts/report.ts` are `BugRecord[]` not `ScoredBug[]`. The `buildHtml` function accepts `ScoredBug[]`. Cast them — `BugRecord` lacks `score`/`source`/`confidence`/`consensusCount` so add defaults:

```ts
  const scoredRecords = records.map((r) => ({
    ...r,
    score: 0,
    source: 'playwright' as const,
    confidence: 1.0,
    consensusCount: 1,
  }));
  const html = await buildHtml(scoredRecords, { crawlDate: DATE, totalPages, sites });
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/report.ts
git commit -m "feat: update report.ts entry point to generate HTML + PDF"
```

---

## Task 11: Smoke test the full pipeline

- [ ] **Step 1: Run all unit tests**

```bash
npx playwright test tests/unit/ --reporter=line
```

Expected: all unit tests PASS.

- [ ] **Step 2: Generate a report from existing scored-bugs.json**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npx tsx scripts/orchestrate.ts 2>&1 | tail -20
```

Expected output includes:
```
✍️  Generating summaries...
🏷️  Assigning categories...
📄 HTML report written to output/audit-report-2026-05-06.html
📄 PDF report written to output/audit-report-2026-05-06.pdf
```

- [ ] **Step 3: Open the HTML report and verify**

```bash
open output/audit-report-2026-05-06.html
```

Verify manually:
- [ ] Header shows RYZE branding, date, and four severity badges with counts
- [ ] "By Severity" tab is active by default; findings render with severity badge, rule ID, summary text, URL list, and screenshot
- [ ] Clicking "By Category" switches the view; categories are grouped with severity sub-ordering
- [ ] Clicking "+ N more" on a URL list expands the overflow
- [ ] Screenshots appear and are cropped (not full-page walls of content)

- [ ] **Step 4: Verify PDF**

```bash
open output/audit-report-2026-05-06.pdf
```

Verify:
- [ ] Only severity view is visible (no tabs, no category section)
- [ ] All URLs are expanded (no "show more" buttons)
- [ ] Cards do not break mid-content across page boundaries

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete HTML/PDF report redesign with LLM summaries and cropped screenshots"
```
