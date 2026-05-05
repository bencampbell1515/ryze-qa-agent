# Orchestrated QA System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Ryze QA Agent with a Claude API validation pass, a persona-driven discovery pass, and a unified scoring engine that ranks all findings by business impact — then publish the whole system to a private GitHub repo.

**Architecture:** Three new layers sit on top of the existing Playwright pipeline: (1) a validation pass where parallel Claude agents confirm or deny each Playwright finding, (2) a discovery pass where four persona agents browse screenshots for human-observable bugs, (3) a pure-TypeScript scoring engine that ranks all findings by revenue/UX/UI impact. The existing pipeline is the floor — all new layers fail gracefully.

**Tech Stack:** `@playwright/test` (existing) · `@anthropic-ai/sdk` (new) · `p-limit` (existing) · `typescript` with NodeNext module resolution · `gh` CLI for GitHub

---

## Phase 1: Foundation — Types, Scoring Engine, README

*No API key required. Ships a better-ordered report immediately.*

---

### Task 1: Extend types for new pipeline fields

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add new types to src/types.ts**

Replace the entire file with:

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

export type BugSource = 'playwright' | 'claude-discovery';

export type VerificationStatus =
  | 'confirmed'
  | 'could-not-reproduce'
  | 'inconclusive'
  | 'unverified';

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
  /** Perceptual dHash binary string (64 chars of '0'/'1') from sharp-phash */
  dHash?: string;
  /** Shopify section anchor for dedup grouping */
  sectionAnchor?: string;
  /** Set by validation pass */
  validated?: boolean;
  /** Confidence 0–1 set by validation pass; defaults to 1.0 for raw Playwright findings */
  confidence?: number;
}

/** A finding submitted by a Claude discovery persona agent. */
export interface DiscoveryFinding {
  url: string;
  screenshot: string;
  quotedElement: string;
  claim: string;
  persona: string;
  severity: Severity;
  bugClass: BugClass;
  ruleId: string;
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

/** A scored finding ready for the report. Extends BugRecord with scoring fields. */
export interface ScoredBug extends BugRecord {
  score: number;
  source: BugSource;
  validated?: boolean;
  confidence: number;
  verificationStatus?: VerificationStatus;
  consensusCount: number;
  discoveryPersona?: string;
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

/** One entry in data/dismissed.jsonl */
export interface DismissedEntry {
  fingerprint: string;
  reason: string;
  dismissedAt: string;
}

/** One entry in data/report-history.jsonl — fingerprints from a completed run */
export interface ReportHistoryEntry {
  runDate: string;
  fingerprints: string[];
}
```

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
npm run tsc
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: extend types for validation, discovery, and scoring pipeline"
```

---

### Task 2: Write failing unit tests for the scoring engine

**Files:**
- Create: `tests/unit/scorer.test.ts`

- [ ] **Step 1: Create tests/unit/ directory and write failing tests**

```typescript
// tests/unit/scorer.test.ts
import { test, expect } from '@playwright/test';
import { scoreBug, getImpactWeight, getPageImportance } from '../../src/scoring/scorer.js';
import type { BugInstance } from '../../src/types.js';

const revenueBug: BugInstance = {
  ruleId: 'revenue:no-atc',
  severity: 'critical',
  bugClass: 'revenue',
  message: 'Add to Cart button not found',
  url: 'https://www.ryzesuperfoods.com/products/ryze-mushroom-coffee',
  viewport: 'desktop',
  timestamp: new Date().toISOString(),
};

const blogUiBug: BugInstance = {
  ruleId: 'a11y:color-contrast',
  severity: 'low',
  bugClass: 'a11y',
  message: 'Low contrast text',
  url: 'https://www.ryzesuperfoods.com/blogs/news/some-post',
  viewport: 'mobile',
  timestamp: new Date().toISOString(),
};

test('revenue bug on PDP scores 8 (no novelty, no consensus, full confidence)', () => {
  const score = scoreBug(revenueBug, {
    knownFingerprints: new Set(['anything']), // treated as known → no novelty
    confidence: 1.0,
    consensusCount: 1,
  });
  // impact(4) + page(3) + novelty(0) + no_multiplier - penalty(0) = 7
  expect(score).toBeCloseTo(7, 1);
});

test('novelty bonus adds 1 when fingerprint is new', () => {
  const withNovelty = scoreBug(revenueBug, {
    knownFingerprints: new Set(), // empty = new fingerprint
    confidence: 1.0,
    consensusCount: 1,
  });
  expect(withNovelty).toBeCloseTo(8, 1);
});

test('consensus multiplier raises score by 1.5x', () => {
  const base = scoreBug(revenueBug, {
    knownFingerprints: new Set(['x']),
    confidence: 1.0,
    consensusCount: 1,
  });
  const consensus = scoreBug(revenueBug, {
    knownFingerprints: new Set(['x']),
    confidence: 1.0,
    consensusCount: 2,
  });
  expect(consensus).toBeCloseTo(base * 1.5, 1);
});

test('confidence penalty subtracts from score', () => {
  const full = scoreBug(revenueBug, {
    knownFingerprints: new Set(['x']),
    confidence: 1.0,
    consensusCount: 1,
  });
  const low = scoreBug(revenueBug, {
    knownFingerprints: new Set(['x']),
    confidence: 0.6,
    consensusCount: 1,
  });
  expect(low).toBeCloseTo(full - 0.4, 1);
});

test('blog UI bug scores lower than revenue PDP bug', () => {
  const ctx = { knownFingerprints: new Set<string>(), confidence: 1.0, consensusCount: 1 };
  const revenueScore = scoreBug(revenueBug, ctx);
  const uiScore = scoreBug(blogUiBug, ctx);
  expect(revenueScore).toBeGreaterThan(uiScore);
});

test('getImpactWeight returns correct weights', () => {
  expect(getImpactWeight('revenue')).toBe(4);
  expect(getImpactWeight('a11y')).toBe(2);
  expect(getImpactWeight('network')).toBe(2);
  expect(getImpactWeight('visual')).toBe(1);
  expect(getImpactWeight('seo')).toBe(1);
  expect(getImpactWeight('content')).toBe(1);
  expect(getImpactWeight('console')).toBe(0.5);
  expect(getImpactWeight('lighthouse')).toBe(1);
});

test('getPageImportance returns correct values', () => {
  expect(getPageImportance('https://www.ryzesuperfoods.com/')).toBe(3);
  expect(getPageImportance('https://www.ryzesuperfoods.com/products/coffee')).toBe(3);
  expect(getPageImportance('https://www.ryzesuperfoods.com/collections/all')).toBe(2);
  expect(getPageImportance('https://www.ryzesuperfoods.com/blogs/news/post')).toBe(1);
  expect(getPageImportance('https://www.ryzesuperfoods.com/pages/about')).toBe(1);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx playwright test tests/unit/scorer.test.ts --reporter=line
```

Expected: all tests FAIL with "Cannot find module '../../src/scoring/scorer.js'"

---

### Task 3: Implement the scoring engine

**Files:**
- Create: `src/scoring/scorer.ts`

- [ ] **Step 1: Create src/scoring/ directory and implement scorer.ts**

```typescript
// src/scoring/scorer.ts
import { createHash } from 'node:crypto';
import { normalizeMessage } from '../dedupe/fingerprint.js';
import type { BugInstance, BugClass } from '../types.js';

export interface ScoreContext {
  /** Fingerprints from the last 3 full-audit:v2 runs (data/report-history.jsonl) */
  knownFingerprints: Set<string>;
  /** Validation confidence 0–1; use 1.0 for raw Playwright findings */
  confidence: number;
  /** Number of independent sources that flagged this finding */
  consensusCount: number;
}

export function getImpactWeight(bugClass: BugClass): number {
  const weights: Record<BugClass, number> = {
    revenue: 4,
    a11y: 2,
    network: 2,
    visual: 1,
    seo: 1,
    content: 1,
    console: 0.5,
    lighthouse: 1,
  };
  return weights[bugClass] ?? 0.5;
}

export function getPageImportance(url: string): number {
  if (
    url.match(/^https?:\/\/[^/]+\/?$/) ||
    url.includes('/products/')
  ) return 3;
  if (url.includes('/collections/')) return 2;
  return 1;
}

function getBugFingerprint(bug: BugInstance): string {
  const normalized = normalizeMessage(bug.message, bug.ruleId);
  return createHash('sha1')
    .update(`${bug.ruleId}|${normalized}|${bug.url}`)
    .digest('hex');
}

export function scoreBug(bug: BugInstance, ctx: ScoreContext): number {
  const impactWeight = getImpactWeight(bug.bugClass);
  const pageImportance = getPageImportance(bug.url);
  const fingerprint = getBugFingerprint(bug);
  const noveltyBonus = ctx.knownFingerprints.size === 0 || !ctx.knownFingerprints.has(fingerprint) ? 1 : 0;
  const confidencePenalty = 1 - ctx.confidence;

  const base = impactWeight + pageImportance + noveltyBonus;
  const multiplied = ctx.consensusCount >= 2 ? base * 1.5 : base;
  return Math.max(0, multiplied - confidencePenalty);
}
```

- [ ] **Step 2: Run scorer unit tests to confirm they pass**

```bash
npx playwright test tests/unit/scorer.test.ts --reporter=line
```

Expected: all 7 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/scoring/scorer.ts tests/unit/scorer.test.ts
git commit -m "feat: implement scoring engine with unit tests"
```

---

### Task 4: Write failing unit tests for the evidence enforcer

**Files:**
- Create: `tests/unit/evidence-enforcer.test.ts`

- [ ] **Step 1: Write failing evidence enforcer tests**

```typescript
// tests/unit/evidence-enforcer.test.ts
import { test, expect } from '@playwright/test';
import { enforceEvidence } from '../../src/scoring/evidence-enforcer.js';

test('passes when all four fields are present', () => {
  const result = enforceEvidence({
    url: 'https://www.ryzesuperfoods.com/products/coffee',
    screenshot: 'output/screenshots/coffee-desktop.png',
    quotedElement: '<span class="price">$39.99</span>',
    claim: 'Bundle price is higher than buying items separately',
    persona: 'revenue-hawk',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:pricing',
    timestamp: new Date().toISOString(),
  });
  expect(result.valid).toBe(true);
  expect(result.reason).toBeUndefined();
});

test('rejects when url is missing', () => {
  const result = enforceEvidence({
    screenshot: 'output/screenshots/coffee-desktop.png',
    quotedElement: '<span>text</span>',
    claim: 'some claim',
    persona: 'revenue-hawk',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:pricing',
    timestamp: new Date().toISOString(),
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('missing url');
});

test('rejects when screenshot is missing', () => {
  const result = enforceEvidence({
    url: 'https://www.ryzesuperfoods.com/products/coffee',
    quotedElement: '<span>text</span>',
    claim: 'some claim',
    persona: 'revenue-hawk',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:pricing',
    timestamp: new Date().toISOString(),
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('missing screenshot');
});

test('rejects when quotedElement is missing', () => {
  const result = enforceEvidence({
    url: 'https://www.ryzesuperfoods.com/products/coffee',
    screenshot: 'output/screenshots/coffee-desktop.png',
    claim: 'some claim',
    persona: 'revenue-hawk',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:pricing',
    timestamp: new Date().toISOString(),
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('missing quotedElement');
});

test('rejects when claim is missing', () => {
  const result = enforceEvidence({
    url: 'https://www.ryzesuperfoods.com/products/coffee',
    screenshot: 'output/screenshots/coffee-desktop.png',
    quotedElement: '<span>text</span>',
    persona: 'revenue-hawk',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:pricing',
    timestamp: new Date().toISOString(),
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('missing claim');
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx playwright test tests/unit/evidence-enforcer.test.ts --reporter=line
```

Expected: FAIL with "Cannot find module '../../src/scoring/evidence-enforcer.js'"

---

### Task 5: Implement the evidence enforcer

**Files:**
- Create: `src/scoring/evidence-enforcer.ts`

- [ ] **Step 1: Implement evidence-enforcer.ts**

```typescript
// src/scoring/evidence-enforcer.ts
import type { DiscoveryFinding } from '../types.js';

export interface EnforcerResult {
  valid: boolean;
  reason?: string;
}

export function enforceEvidence(finding: Partial<DiscoveryFinding>): EnforcerResult {
  if (!finding.url) return { valid: false, reason: 'missing url' };
  if (!finding.screenshot) return { valid: false, reason: 'missing screenshot' };
  if (!finding.quotedElement) return { valid: false, reason: 'missing quotedElement' };
  if (!finding.claim) return { valid: false, reason: 'missing claim' };
  return { valid: true };
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
npx playwright test tests/unit/evidence-enforcer.test.ts --reporter=line
```

Expected: all 5 tests PASS.

- [ ] **Step 3: Run full tsc to confirm no new type errors**

```bash
npm run tsc
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/scoring/evidence-enforcer.ts tests/unit/evidence-enforcer.test.ts
git commit -m "feat: implement evidence enforcer with unit tests"
```

---

### Task 6: Update .gitignore and package.json

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Update .gitignore to include new data files**

Add these lines to `.gitignore`:

```
data/dismissed.jsonl
data/report-history.jsonl
data/validated-bugs.jsonl
data/discoveries.jsonl
data/scored-bugs.json
```

- [ ] **Step 2: Update package.json scripts**

Replace the `"scripts"` block with:

```json
"scripts": {
  "test:crawl": "tsx scripts/crawl.ts",
  "test:audit": "playwright test tests/crawl.spec.ts --grep @audit",
  "test:unit": "playwright test tests/unit/ --reporter=line",
  "test:smoke": "playwright test tests/smoke/ --reporter=line",
  "lint:personas": "tsx scripts/lint-personas.ts",
  "report": "tsx scripts/report.ts",
  "clean": "rm -f data/bugs.jsonl data/tmp/*.txt data/validated-bugs.jsonl data/discoveries.jsonl data/scored-bugs.json",
  "dismiss": "tsx scripts/dismiss.ts",
  "validate": "tsx scripts/validate.ts",
  "discover": "tsx scripts/discover.ts",
  "reverify": "tsx scripts/reverify.ts",
  "orchestrate": "tsx scripts/orchestrate.ts",
  "full-audit": "npm run clean && npm run test:crawl && npm run test:audit && npm run report",
  "full-audit:v2": "npm run clean && npm run test:crawl && npm run test:audit && npm run orchestrate",
  "tsc": "tsc --noEmit"
}
```

- [ ] **Step 3: Verify tsc still passes**

```bash
npm run tsc
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add .gitignore package.json
git commit -m "chore: update .gitignore and package.json for new pipeline scripts"
```

---

### Task 7: Write the persona linter

**Files:**
- Create: `scripts/lint-personas.ts`

- [ ] **Step 1: Implement lint-personas.ts**

```typescript
// scripts/lint-personas.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PERSONAS_DIR = join(process.cwd(), 'personas');
const REQUIRED_SECTIONS = [
  '## Background',
  '## Mandate',
  '## Blind Spots',
  '## Evidence Requirements',
  '## How to Frame Findings',
];

const files = readdirSync(PERSONAS_DIR).filter((f) => f.endsWith('.md'));
let failed = false;

for (const file of files) {
  const content = readFileSync(join(PERSONAS_DIR, file), 'utf8');
  const missing = REQUIRED_SECTIONS.filter((s) => !content.includes(s));
  if (missing.length > 0) {
    console.error(`❌ ${file} is missing sections: ${missing.join(', ')}`);
    failed = true;
  } else {
    console.log(`✅ ${file}`);
  }
}

if (failed) process.exit(1);
console.log('\nAll persona files pass structure check.');
```

- [ ] **Step 2: Create the personas/ directory**

```bash
mkdir -p personas
```

- [ ] **Step 3: Commit the linter (personas will be added in Phase 2)**

```bash
git add scripts/lint-personas.ts
git commit -m "feat: add persona file structure linter"
```

---

### Task 8: Write the README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
# Ryze QA Agent

Automated bug-hunting agent for [ryzesuperfoods.com](https://www.ryzesuperfoods.com) and [shop.ryzesuperfoods.com](https://shop.ryzesuperfoods.com). Crawls the live site, finds bugs across seven check modules, validates findings with Claude AI, and produces a priority-ranked `.docx` audit report.

## What it does

1. **Crawls** the sitemap and discovers all URLs (home, products, collections, blogs, pages)
2. **Audits** every URL across desktop, tablet, and mobile viewports using Playwright — checking accessibility, network errors, revenue flows, SEO, visual layout, content, and performance
3. **Validates** each finding using Claude AI agents — confirming real bugs and filtering false positives
4. **Discovers** additional human-observable bugs using four AI personas with distinct worldviews (revenue, UX, brand, technical)
5. **Scores** every finding by business impact — revenue issues first, then UX, then UI
6. **Reports** a priority-ranked `.docx` with an executive summary and evidence screenshots

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
npm run orchestrate       # validate + discover + score + report → output/audit-report-<date>.docx
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
                                                    report.ts → audit-report.docx
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
| `npm run report` | Dedupe + build .docx from bugs.jsonl (legacy, no scoring) |
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
```

- [ ] **Step 2: Commit the README**

```bash
git add README.md
git commit -m "docs: add comprehensive README for orchestrated QA system"
```

---

## Phase 2: Persona Files + Validation Pass

*Requires `ANTHROPIC_API_KEY`. Reduces false positives in the report.*

---

### Task 9: Install the Anthropic SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @anthropic-ai/sdk**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Verify it installed**

```bash
node -e "import('@anthropic-ai/sdk').then(m => console.log('SDK version:', m.default.VERSION ?? 'ok'))"
```

Expected: prints SDK version or "ok" without errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @anthropic-ai/sdk dependency"
```

---

### Task 10: Write all six persona files

**Files:**
- Create: `personas/orchestrator.md`
- Create: `personas/revenue-hawk.md`
- Create: `personas/skeptical-first-timer.md`
- Create: `personas/brand-purist.md`
- Create: `personas/forensic-technician.md`
- Create: `personas/dr-marcus-chen.md`

- [ ] **Step 1: Write personas/orchestrator.md**

```markdown
# The Orchestrator
## QA System Arbiter and Scoring Engine

---

## Background
You are the main orchestrating agent in a multi-persona QA system for ryzesuperfoods.com. You do not browse pages or submit findings yourself. Your role is to read findings from four persona agents, apply bias corrections, score each finding by business impact, and produce a ranked, actionable output.

You know each persona's biases intimately and correct for them.

---

## Mandate
- Read all findings submitted by Revenue Hawk, Skeptical First-Timer, Brand Purist, and Forensic Technician
- Apply bias corrections per persona (see Blind Spots section)
- Detect consensus: when 2+ personas flag the same URL+issue, apply the 1.5× consensus multiplier
- Enforce severity floors: lone Claude discovery findings are capped at Medium
- Output findings in descending score order
- Flag findings that scored high but came from only one persona as "needs human review"

---

## Blind Spots
- You tend to undervalue brand and copy issues because they're hard to quantify in revenue terms. Consciously resist this. A brand inconsistency on the homepage matters.
- You trust Playwright findings more than Claude discovery findings. This is correct, but don't dismiss discovery findings that have strong evidence — they catch things Playwright can't.

---

## Evidence Requirements
You do not submit evidence — you evaluate it. Reject any finding from a persona agent that is missing url, screenshot, quotedElement, or claim. Log the rejection with the persona name and reason.

---

## How to Frame Findings
When arbitrating a conflict between personas (e.g., Revenue Hawk says severity:critical, Brand Purist says severity:medium for the same issue), output the higher severity if the revenue impact is plausible, otherwise the lower one. Document your reasoning in a `arbitrationNote` field.
```

- [ ] **Step 2: Write personas/revenue-hawk.md**

```markdown
# Revenue Hawk
## Conversion and Revenue Flow Specialist

---

## Background
You are a conversion rate optimization specialist who has spent a decade analyzing e-commerce funnels. You've seen thousands of Shopify stores and you know exactly what costs brands money. You look at every page through one lens: is this losing us a sale right now?

You are familiar with Recharge subscriptions, Shopify's Liquid templating, and the psychology of supplement e-commerce buyers. You know that trust is fragile and a single broken element can kill a conversion.

---

## Mandate
Examine product pages, the cart, and the checkout path for:
- ATC buttons that are missing, hidden, or non-functional
- Bundle pricing that doesn't represent a real discount vs. buying items separately (do the math)
- Sale timers or countdown clocks that reset on page refresh (evergreen timers = fake urgency = trust killer)
- Trust signals that fail to load: star ratings, review counts, Trustpilot widget, "as seen on" logos, money-back guarantee badges
- Subscribe & Save toggle: is it visible? Is the per-order price correct vs one-time price?
- Any price that shows $0, NaN, or is blank

---

## Blind Spots
- You overstate urgency. A broken review widget is not always Critical — it's High unless it's on the homepage or a hero PDP.
- You sometimes flag things that are intentionally design choices (e.g., no price shown until variant is selected). Check whether the issue is actually present before flagging.
- The orchestrator will discount your severity by one level if you're the only persona flagging something.

---

## Evidence Requirements
Every finding you submit MUST include:
- `url`: the exact page URL where you found the issue
- `screenshot`: the path to the existing screenshot for that page/viewport
- `quotedElement`: the exact text or HTML of the broken element
- `claim`: one sentence on what is wrong and why it costs money

Findings without all four fields will be rejected before scoring.

---

## How to Frame Findings
Lead with the revenue impact. "This bundle shows $89 for items that cost $76 separately — the 'discount' is actually a markup. Any buyer who checks will not convert and will not return." Be specific about the dollar amount when possible.
```

- [ ] **Step 3: Write personas/skeptical-first-timer.md**

```markdown
# The Skeptical First-Timer
## New Customer Perspective Analyst

---

## Background
You are a 34-year-old who just heard about RYZE from a podcast. You're interested but not convinced. You're browsing on your phone, you've never ordered from this site before, and you have three tabs open comparing mushroom coffee brands. You will leave at the first sign of confusion or distrust.

You evaluate everything from the perspective of someone who has never heard of this brand and is deciding whether to trust it with their credit card.

---

## Mandate
Examine pages (especially on mobile) for:
- Navigation that is broken, confusing, or leads to dead ends
- Social proof that fails to load: reviews, star ratings, UGC photos, "verified buyer" badges
- Health claims that contradict each other across different pages (e.g., "30-day supply" on one page, "25-day supply" on another)
- "As seen on" logos or press quotes that don't load or link to anything real
- Purchase path dead ends: any point where a buyer could get stuck or lost
- Copy that feels inconsistent, salesy in a way that triggers skepticism, or doesn't answer obvious questions (what's in it? why does it taste good?)

---

## Blind Spots
- You underweight desktop-only issues. If something is broken on desktop but fine on mobile, you'll deprioritize it. The orchestrator will correct for this when desktop traffic is significant.
- You focus too much on the purchase path and sometimes miss brand issues that don't directly affect conversion but matter for retention.

---

## Evidence Requirements
Every finding you submit MUST include:
- `url`: the exact page URL where you found the issue
- `screenshot`: the path to the existing screenshot for that page/viewport (prefer mobile screenshots)
- `quotedElement`: the exact text or HTML of the broken element
- `claim`: one sentence on why this would make a first-time buyer leave

Findings without all four fields will be rejected before scoring.

---

## How to Frame Findings
Frame from the buyer's perspective. "A new visitor who scrolls to the reviews section on mobile sees a blank white box where the Okendo widget should be. No reviews visible = no trust = no purchase."
```

- [ ] **Step 4: Write personas/brand-purist.md**

```markdown
# The Brand Purist
## Brand Voice and Consistency Guardian

---

## Background
You know the RYZE brand deeply. You know their positioning (premium, functional, approachable), their product names, their tone (warm, knowledgeable, not preachy), and their visual identity. You have read every page of their website and you notice immediately when something is off.

You care about consistency. A brand that can't spell its own product name consistently, or whose copy changes register between the PDP and the collection page, is a brand that loses trust slowly — one impression at a time.

---

## Mandate
Examine pages for:
- Product naming inconsistencies (e.g., "Mushroom Coffee" vs "RYZE Mushroom Coffee" vs "ryze coffee" vs "mushroom blend" — pick one)
- Off-brand tone: overly salesy language, discount-heavy framing that cheapens the premium positioning, clinical language that removes warmth
- Copy that contradicts itself between the PDP, collection page, and email opt-in
- Cross-sell / "you might also like" sections that recommend irrelevant products
- Discount badge language that feels desperate ("80% OFF!!!" is not the RYZE register)
- Missing or broken brand assets: logo variations, product lifestyle photos, brand color usage

---

## Blind Spots
- You overstate brand issues. "The font weight looks slightly different" is not a bug. Focus on things that would actually confuse or alienate a customer, not micro-inconsistencies.
- Lone brand findings are capped at Medium by the orchestrator unless Playwright also confirms something broken.

---

## Evidence Requirements
Every finding you submit MUST include:
- `url`: the exact page URL where you found the issue
- `screenshot`: the path to the existing screenshot for that page/viewport
- `quotedElement`: the exact copy or element that is off-brand (quote it verbatim)
- `claim`: one sentence on why this inconsistency matters to a customer

Findings without all four fields will be rejected before scoring.

---

## How to Frame Findings
Quote the problematic copy exactly. "The collection page says 'Mushroom Coffee Powder' but the PDP says 'RYZE Mushroom Coffee Blend' — a customer who searches for the product they just bought will find a different name."
```

- [ ] **Step 5: Write personas/forensic-technician.md**

```markdown
# The Forensic Technician
## Technical Accuracy and Instrumentation Specialist

---

## Background
You are a technical SEO and analytics engineer. You have audited hundreds of Shopify stores. You know exactly what structured data should be present on a product page, what canonical tags should point to, and what network requests should fire when a user adds to cart.

You don't care about opinions. You care about what is technically correct or incorrect. You verify claims against standards (schema.org, Google's structured data docs, Shopify's documentation).

---

## Mandate
Examine pages for:
- Product JSON-LD schema: must include `@type: Product`, `name`, `offers.price`, `offers.availability`, and `aggregateRating` if reviews exist. Flag if missing or malformed.
- BreadcrumbList schema: must match the actual URL hierarchy. Flag if the breadcrumb says "Home > Products > Coffee" but the URL is `/collections/mushroom-coffee/coffee`.
- Canonical tags: must point to the canonical URL, not a redirect target. Flag if `<link rel="canonical">` is missing or points to a different URL than the page.
- 404 pages: when a user hits a dead URL, does the page offer helpful navigation (search bar, popular products, home link)? Flag if it's a bare "page not found" with no escape route.
- Analytics events: using Playwright's network interception, check that on ATC click a network request fires to an analytics endpoint (any of: Amplitude, GTM, Klaviyo). Flag if no analytics request fires within 5s of ATC.

---

## Blind Spots
- You undervalue UX issues that aren't technically incorrect. A JSON-LD schema that is technically valid but confusing to users is not your problem — let Skeptical First-Timer handle that.
- You sometimes flag things that are intentionally omitted (e.g., no aggregateRating schema when the brand is suppressing reviews on that page). Check context before flagging as critical.

---

## Evidence Requirements
Every finding you submit MUST include:
- `url`: the exact page URL where you found the issue
- `screenshot`: the path to the existing screenshot for that page/viewport
- `quotedElement`: the exact malformed markup, missing tag, or network request (or lack thereof)
- `claim`: one sentence on what standard is violated and what the impact is (SEO, analytics, UX)

Findings without all four fields will be rejected before scoring.

---

## How to Frame Findings
Be precise and reference the standard. "The PDP at /products/ryze-mushroom-coffee is missing `offers.availability` in its Product JSON-LD schema. Google requires this field for rich results eligibility. Current schema has name and price but no availability."
```

- [ ] **Step 6: Write personas/dr-marcus-chen.md**

```markdown
# Dr. Marcus Chen
## Systems Architect for Conversion Ecosystems

---

## Background
Spent 15 years as a direct response copywriter (trained under Gary Halbert, worked with Agora), then pivoted to information product architecture at scale (built the backend systems for several $100M+ info businesses), then became obsessed with feedback loops and evolutionary systems after studying complex adaptive systems at Santa Fe Institute.

Now consults exclusively on "conversion ecosystems" — systems that learn and improve their own conversion rates over time. He doesn't see copy, products, or systems as separate things. He sees them as nodes in a feedback network.

**"The best QA system isn't the one that finds the most bugs today. It's the one with the fastest rate of improvement."**

---

## Mandate
You do NOT submit page-level bug findings. Your job is to evaluate the QA system itself each run.

Analyze `data/dismissed.jsonl` and `data/report-history.jsonl` and produce a system health report with:
- **Dismissed-to-found ratio** for this run vs last 3 runs (trending up = noisy system, trending down = improving)
- **Which check module generates the most dismissed findings** (candidate for tuning)
- **Novelty rate**: what % of this run's findings are new fingerprints vs. recurring ones
- **Feedback latency assessment**: how many days between when a bug type first appeared and when it was dismissed or fixed?
- **One leverage point**: the single highest-ROI change to the QA system that the data suggests

---

## Blind Spots
- You optimize for long-term system improvement over short-term results. If the dismissed ratio is high, you'll recommend tuning the system even if the current report is still useful. Balance this — the report has to ship today.
- You trust data over intuition. But some dismissed findings are dismissed because the reviewer didn't understand them, not because they were false positives. Flag this possibility when dismissal rates are suspiciously high.

---

## Evidence Requirements
Your output is a structured system health report, not a page-level finding. Include:
- Dismissed-to-found ratio (number and trend)
- Top noise-generating check module
- Novelty rate percentage
- Feedback latency summary
- One specific, actionable leverage point

---

## How to Frame Findings
Use his language: "Your feedback latency is 18 days on average — you're learning too slowly. The highest-ROI change is to add a `resolvedAt` timestamp to dismissed.jsonl so we can measure fix velocity, not just dismissal rate."
```

- [ ] **Step 7: Run the persona linter**

```bash
npm run lint:personas
```

Expected: all 6 files pass. If any fail, add the missing section.

- [ ] **Step 8: Commit all persona files**

```bash
git add personas/
git commit -m "feat: add all six persona files (orchestrator, revenue-hawk, skeptical-first-timer, brand-purist, forensic-technician, dr-marcus-chen)"
```

---

### Task 11: Implement the dismiss script

**Files:**
- Create: `scripts/dismiss.ts`

- [ ] **Step 1: Implement scripts/dismiss.ts**

```typescript
// scripts/dismiss.ts
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DismissedEntry } from '../src/types.js';

const DISMISSED_PATH = join(process.cwd(), 'data', 'dismissed.jsonl');

const args = process.argv.slice(2);
const fingerprintFlag = args.indexOf('--fingerprint');
const reasonFlag = args.indexOf('--reason');

if (fingerprintFlag === -1 || reasonFlag === -1) {
  console.error('Usage: npm run dismiss -- --fingerprint <id> --reason "<reason>"');
  process.exit(1);
}

const fingerprint = args[fingerprintFlag + 1];
const reason = args[reasonFlag + 1];

if (!fingerprint || !reason) {
  console.error('Both --fingerprint and --reason are required.');
  process.exit(1);
}

// Check for duplicates
if (existsSync(DISMISSED_PATH)) {
  const existing = readFileSync(DISMISSED_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as DismissedEntry);
  if (existing.some((e) => e.fingerprint === fingerprint)) {
    console.log(`ℹ️  Fingerprint ${fingerprint} already dismissed.`);
    process.exit(0);
  }
}

const entry: DismissedEntry = {
  fingerprint,
  reason,
  dismissedAt: new Date().toISOString(),
};

appendFileSync(DISMISSED_PATH, JSON.stringify(entry) + '\n');
console.log(`✅ Dismissed ${fingerprint}: "${reason}"`);
```

- [ ] **Step 2: Test it runs without error**

```bash
npm run dismiss -- --fingerprint test123 --reason "test dismissal"
```

Expected: prints `✅ Dismissed test123: "test dismissal"` and creates `data/dismissed.jsonl`.

```bash
npm run dismiss -- --fingerprint test123 --reason "test dismissal"
```

Expected: prints `ℹ️  Fingerprint test123 already dismissed.` (no duplicate).

- [ ] **Step 3: Clean up test dismissal**

```bash
rm -f data/dismissed.jsonl
```

- [ ] **Step 4: Commit**

```bash
git add scripts/dismiss.ts
git commit -m "feat: add dismiss script for false positive management"
```

---

### Task 12: Implement the validation pass

**Files:**
- Create: `scripts/validate.ts`
- Create: `tests/fixtures/claude-responses/validation-sample.json`

- [ ] **Step 1: Create validation fixture**

```bash
mkdir -p tests/fixtures/claude-responses
```

Create `tests/fixtures/claude-responses/validation-sample.json`:

```json
{
  "id": "msg_fixture",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "{\"validated\": true, \"confidence\": 0.92, \"reason\": \"The screenshot confirms the broken image — a 404 placeholder is clearly visible in the hero section.\"}"
    }
  ],
  "model": "claude-haiku-4-5-20251001",
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 100, "output_tokens": 50 }
}
```

- [ ] **Step 2: Implement scripts/validate.ts**

```typescript
// scripts/validate.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import type { BugInstance, DismissedEntry } from '../src/types.js';
import { computeFingerprint } from '../src/dedupe/fingerprint.js';

const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const DISMISSED_PATH = join(process.cwd(), 'data', 'dismissed.jsonl');
const OUTPUT_PATH = join(process.cwd(), 'data', 'validated-bugs.jsonl');
const BATCH_SIZE = 20;

function loadDismissed(): Set<string> {
  if (!existsSync(DISMISSED_PATH)) return new Set();
  return new Set(
    readFileSync(DISMISSED_PATH, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as DismissedEntry).fingerprint),
  );
}

async function validateBug(
  client: Anthropic,
  bug: BugInstance,
): Promise<{ validated: boolean; confidence: number }> {
  const content: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: `You are a QA validation agent. A Playwright test flagged the following issue on a Shopify e-commerce site. Determine whether this is a real bug or a false positive (e.g., bot-artifact, timing issue, intentional design).

Rule ID: ${bug.ruleId}
Severity: ${bug.severity}
URL: ${bug.url}
Viewport: ${bug.viewport}
Message: ${bug.message}
${bug.outerHTMLSnippet ? `HTML snippet: ${bug.outerHTMLSnippet}` : ''}

Respond with JSON only: {"validated": true/false, "confidence": 0.0–1.0, "reason": "one sentence"}`,
    },
  ];

  // Attach screenshot if available
  if (bug.elementScreenshot && existsSync(bug.elementScreenshot)) {
    const imgData = readFileSync(bug.elementScreenshot).toString('base64');
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: imgData },
    });
  }

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content }],
    });

    const text = (response.content[0] as Anthropic.TextBlock).text;
    const parsed = JSON.parse(text) as { validated: boolean; confidence: number };
    return { validated: parsed.validated, confidence: parsed.confidence };
  } catch {
    // Default: keep the finding but mark conservative confidence
    return { validated: true, confidence: 0.5 };
  }
}

async function main(): Promise<void> {
  if (!existsSync(BUGS_PATH)) {
    console.error('data/bugs.jsonl not found. Run npm run test:audit first.');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — copying bugs.jsonl with default confidence.');
    const raw = readFileSync(BUGS_PATH, 'utf8');
    writeFileSync(OUTPUT_PATH, raw);
    return;
  }

  const client = new Anthropic({ apiKey });
  const dismissed = loadDismissed();

  const lines = readFileSync(BUGS_PATH, 'utf8').split('\n').filter(Boolean);
  const bugs: BugInstance[] = lines.map((l) => JSON.parse(l) as BugInstance);

  // Filter dismissed
  const active = bugs.filter((b) => {
    const fp = computeFingerprint(b.ruleId, b.message, b.sectionAnchor ?? 'document', b.dHash);
    return !dismissed.has(fp);
  });

  console.log(`Validating ${active.length} findings (${bugs.length - active.length} dismissed)...`);

  const limit = pLimit(BATCH_SIZE);
  const results = await Promise.all(
    active.map((bug) =>
      limit(async () => {
        const { validated, confidence } = await validateBug(client, bug);
        return { ...bug, validated, confidence };
      }),
    ),
  );

  writeFileSync(OUTPUT_PATH, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const passCount = results.filter((r) => r.validated).length;
  console.log(`✅ Validation complete: ${passCount}/${results.length} confirmed, ${results.length - passCount} invalidated.`);
  console.log(`Written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Validation pass failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run tsc
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/validate.ts tests/fixtures/claude-responses/validation-sample.json
git commit -m "feat: implement Claude API validation pass for Playwright findings"
```

---

## Phase 3: Discovery Pass, Orchestrator, and Enhanced Report

*Full system. Ships the scored, persona-discovered report.*

---

### Task 13: Implement the discovery pass

**Files:**
- Create: `scripts/discover.ts`

- [ ] **Step 1: Implement scripts/discover.ts**

```typescript
// scripts/discover.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { DiscoveryFinding, UrlList } from '../src/types.js';
import { enforceEvidence } from '../src/scoring/evidence-enforcer.js';

const URL_LIST_PATH = join(process.cwd(), 'output', 'url-list.json');
const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');
const PERSONAS_DIR = join(process.cwd(), 'personas');
const OUTPUT_PATH = join(process.cwd(), 'data', 'discoveries.jsonl');

const PERSONAS = [
  'revenue-hawk',
  'skeptical-first-timer',
  'brand-purist',
  'forensic-technician',
];

function loadPersona(name: string): string {
  const path = join(PERSONAS_DIR, `${name}.md`);
  if (!existsSync(path)) throw new Error(`Persona file not found: ${path}`);
  return readFileSync(path, 'utf8');
}

function getScreenshotsForUrl(url: string): string[] {
  const urlSlug = url.replace(/https?:\/\//, '').replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '');
  const viewports = ['desktop', 'tablet', 'mobile'];
  return viewports
    .map((v) => join(SCREENSHOTS_DIR, `${urlSlug}-${v}.png`))
    .filter(existsSync);
}

async function runPersonaAgent(
  client: Anthropic,
  personaName: string,
  urls: string[],
): Promise<DiscoveryFinding[]> {
  const persona = loadPersona(personaName);
  const timestamp = new Date().toISOString();
  const findings: DiscoveryFinding[] = [];

  // Sample up to 20 URLs per persona to keep costs manageable
  const sample = urls.slice(0, 20);

  for (const url of sample) {
    const screenshots = getScreenshotsForUrl(url);
    if (screenshots.length === 0) continue;

    const content: Anthropic.MessageParam['content'] = [
      {
        type: 'text',
        text: `You are analyzing the following page for bugs relevant to your persona.\n\nPage URL: ${url}\n\nReview the screenshot(s) and return a JSON array of findings. Each finding must include ALL of: url, screenshot (use the first screenshot path), quotedElement, claim, persona, severity (critical/high/medium/low), bugClass (revenue/a11y/network/visual/seo/content/console/lighthouse), ruleId (discovery:<slug>).\n\nIf you find no issues, return an empty array []. Return JSON only.`,
      },
    ];

    // Attach up to 2 screenshots
    for (const shot of screenshots.slice(0, 2)) {
      const imgData = readFileSync(shot).toString('base64');
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: imgData },
      });
    }

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: persona,
        messages: [{ role: 'user', content }],
      });

      const text = (response.content[0] as Anthropic.TextBlock).text;
      const parsed = JSON.parse(text) as Partial<DiscoveryFinding>[];

      for (const raw of parsed) {
        const candidate = { ...raw, persona: personaName, timestamp };
        const check = enforceEvidence(candidate);
        if (!check.valid) {
          console.warn(`  ⚠️  ${personaName} finding rejected (${check.reason}): ${url}`);
          continue;
        }
        findings.push(candidate as DiscoveryFinding);
      }
    } catch (err) {
      console.warn(`  ⚠️  ${personaName} agent error on ${url}:`, err instanceof Error ? err.message : err);
    }
  }

  return findings;
}

async function main(): Promise<void> {
  if (!existsSync(URL_LIST_PATH)) {
    console.error('output/url-list.json not found. Run npm run test:crawl first.');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — skipping discovery pass. Writing empty discoveries.jsonl.');
    writeFileSync(OUTPUT_PATH, '');
    return;
  }

  const client = new Anthropic({ apiKey });
  const urlList = JSON.parse(readFileSync(URL_LIST_PATH, 'utf8')) as UrlList;
  const allUrls = Object.values(urlList).flat();

  console.log(`Running ${PERSONAS.length} persona agents against ${allUrls.length} URLs...`);

  // Run all personas in parallel
  const results = await Promise.allSettled(
    PERSONAS.map(async (p) => {
      console.log(`  → ${p} starting...`);
      const findings = await runPersonaAgent(client, p, allUrls);
      console.log(`  ✅ ${p} found ${findings.length} issues`);
      return findings;
    }),
  );

  const allFindings: DiscoveryFinding[] = results
    .filter((r): r is PromiseFulfilledResult<DiscoveryFinding[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  writeFileSync(OUTPUT_PATH, allFindings.map((f) => JSON.stringify(f)).join('\n') + '\n');
  console.log(`✅ Discovery complete: ${allFindings.length} findings written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Discovery pass failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run tsc
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/discover.ts
git commit -m "feat: implement parallel persona discovery pass"
```

---

### Task 14: Implement the re-verification pass

**Files:**
- Create: `scripts/reverify.ts`

- [ ] **Step 1: Implement scripts/reverify.ts**

```typescript
// scripts/reverify.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import type { ScoredBug, VerificationStatus } from '../src/types.js';

const SCORED_PATH = join(process.cwd(), 'data', 'scored-bugs.json');
const TOP_N = 10;
const NAV_TIMEOUT = 30_000;

async function verifyBug(bug: ScoredBug): Promise<VerificationStatus> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(bug.urls[0], { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });

    if (bug.ruleId.startsWith('network:404')) {
      const url = bug.description.match(/https?:\/\/\S+/)?.[0];
      if (!url) return 'inconclusive';
      const response = await page.request.get(url, { timeout: 10_000 }).catch(() => null);
      if (!response) return 'inconclusive';
      return response.status() === 404 ? 'confirmed' : 'could-not-reproduce';
    }

    if (bug.ruleId.startsWith('a11y:') && bug.selector) {
      const el = page.locator(bug.selector).first();
      const visible = await el.isVisible().catch(() => false);
      return visible ? 'confirmed' : 'could-not-reproduce';
    }

    if (bug.ruleId.startsWith('revenue:')) {
      const atcSelectors = ['button[name="add"]', 'button:has-text("Add to Cart")', 'button:has-text("Subscribe")'];
      for (const sel of atcSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 5_000 }).catch(() => false)) return 'could-not-reproduce';
      }
      return 'confirmed';
    }

    return 'inconclusive';
  } catch {
    return 'inconclusive';
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(SCORED_PATH)) {
    console.warn('data/scored-bugs.json not found — skipping re-verification.');
    return;
  }

  const bugs: ScoredBug[] = JSON.parse(readFileSync(SCORED_PATH, 'utf8'));
  const topBugs = bugs.slice(0, TOP_N);

  console.log(`Re-verifying top ${topBugs.length} findings...`);

  for (const bug of topBugs) {
    process.stdout.write(`  → [${bug.score.toFixed(1)}] ${bug.ruleId} @ ${bug.urls[0]}... `);
    const status = await verifyBug(bug);
    bug.verificationStatus = status;
    const icon = status === 'confirmed' ? '✅' : status === 'could-not-reproduce' ? '❌' : '❓';
    console.log(`${icon} ${status}`);
  }

  // Write back full array with updated statuses
  writeFileSync(SCORED_PATH, JSON.stringify(bugs, null, 2));
  console.log('Re-verification complete.');
}

main().catch((err) => {
  console.error('Re-verification pass failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run tsc
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/reverify.ts
git commit -m "feat: implement Playwright re-verification pass for top 10 findings"
```

---

### Task 15: Implement the orchestrator

**Files:**
- Create: `scripts/orchestrate.ts`

- [ ] **Step 1: Implement scripts/orchestrate.ts**

```typescript
// scripts/orchestrate.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BugInstance, DiscoveryFinding, ScoredBug, BugClass, ReportHistoryEntry } from '../src/types.js';
import { deduplicateBugs } from '../src/dedupe/fingerprint.js';
import { scoreBug } from '../src/scoring/scorer.js';
import { enforceEvidence } from '../src/scoring/evidence-enforcer.js';
import { buildDocx } from '../src/report/docx-builder.js';

const execFileAsync = promisify(execFile);

const VALIDATED_PATH = join(process.cwd(), 'data', 'validated-bugs.jsonl');
const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const DISCOVERIES_PATH = join(process.cwd(), 'data', 'discoveries.jsonl');
const SCORED_PATH = join(process.cwd(), 'data', 'scored-bugs.json');
const HISTORY_PATH = join(process.cwd(), 'data', 'report-history.jsonl');
const OUTPUT_DIR = join(process.cwd(), 'output');
const DATE = new Date().toISOString().slice(0, 10);

const SEVERITY_FLOORS: Record<string, string[]> = {
  'claude-discovery-lone': ['critical', 'high'],
};

function loadKnownFingerprints(): Set<string> {
  if (!existsSync(HISTORY_PATH)) return new Set();
  const entries: ReportHistoryEntry[] = readFileSync(HISTORY_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ReportHistoryEntry)
    .slice(-3); // last 3 runs
  return new Set(entries.flatMap((e) => e.fingerprints));
}

function saveToHistory(fingerprints: string[]): void {
  const entry: ReportHistoryEntry = {
    runDate: new Date().toISOString(),
    fingerprints,
  };
  const existing = existsSync(HISTORY_PATH)
    ? readFileSync(HISTORY_PATH, 'utf8').split('\n').filter(Boolean)
    : [];
  const updated = [...existing.slice(-2), JSON.stringify(entry)]; // keep last 3
  writeFileSync(HISTORY_PATH, updated.join('\n') + '\n');
}

async function runScript(script: string): Promise<void> {
  console.log(`\n▶ Running ${script}...`);
  try {
    await execFileAsync('npx', ['tsx', `scripts/${script}.ts`], {
      env: process.env,
      cwd: process.cwd(),
    });
  } catch (err) {
    console.warn(`⚠️  ${script} failed — continuing with fallback behavior. Error:`, err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Step 1: Run validation and discovery in parallel
  await Promise.all([runScript('validate'), runScript('discover')]);

  // Step 2: Load validated bugs (fall back to raw if validation failed)
  const bugsSource = existsSync(VALIDATED_PATH) ? VALIDATED_PATH : BUGS_PATH;
  if (!existsSync(bugsSource)) {
    console.error('No bug data found. Run npm run test:audit first.');
    process.exit(1);
  }

  const playwrightBugs: BugInstance[] = readFileSync(bugsSource, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BugInstance);

  // Step 3: Load and validate discovery findings
  const discoveries: DiscoveryFinding[] = existsSync(DISCOVERIES_PATH)
    ? readFileSync(DISCOVERIES_PATH, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as DiscoveryFinding)
        .filter((f) => enforceEvidence(f).valid)
    : [];

  // Step 4: Detect consensus (same URL + ruleId from multiple sources)
  const consensusMap = new Map<string, number>();
  for (const b of playwrightBugs) {
    const key = `${b.url}|${b.ruleId}`;
    consensusMap.set(key, (consensusMap.get(key) ?? 0) + 1);
  }
  for (const d of discoveries) {
    const key = `${d.url}|${d.ruleId}`;
    consensusMap.set(key, (consensusMap.get(key) ?? 0) + 1);
  }

  // Step 5: Convert discoveries to BugInstance format for dedup
  const discoveryAsBugs: BugInstance[] = discoveries.map((d) => ({
    ruleId: d.ruleId,
    severity: d.severity,
    bugClass: d.bugClass as BugClass,
    message: d.claim,
    url: d.url,
    viewport: 'desktop' as const,
    timestamp: d.timestamp,
    outerHTMLSnippet: d.quotedElement,
    pageScreenshot: d.screenshot,
    confidence: 1.0,
    validated: true,
  }));

  const allBugs = [...playwrightBugs, ...discoveryAsBugs];
  const deduplicated = deduplicateBugs(allBugs);

  // Step 6: Score every finding
  const knownFingerprints = loadKnownFingerprints();

  const scored: ScoredBug[] = deduplicated.map((record) => {
    const bug = allBugs.find((b) => b.url === record.urls[0] && b.ruleId === record.ruleId);
    const consensusKey = `${record.urls[0]}|${record.ruleId}`;
    const consensusCount = consensusMap.get(consensusKey) ?? 1;
    const confidence = bug?.confidence ?? 1.0;
    const isDiscovery = discoveries.some((d) => d.ruleId === record.ruleId && d.url === record.urls[0]);

    // Apply severity floor for lone discovery findings
    let severity = record.severity;
    if (isDiscovery && consensusCount < 2 && (severity === 'critical' || severity === 'high')) {
      severity = 'medium';
    }

    const fakeBug: BugInstance = {
      ruleId: record.ruleId,
      severity,
      bugClass: record.bugClass,
      message: record.description,
      url: record.urls[0],
      viewport: record.viewports[0] ?? 'desktop',
      timestamp: new Date().toISOString(),
    };

    const score = scoreBug(fakeBug, { knownFingerprints, confidence, consensusCount });
    const discoveryPersona = discoveries.find((d) => d.ruleId === record.ruleId && d.url === record.urls[0])?.persona;

    return {
      ...record,
      severity,
      score,
      source: isDiscovery ? 'claude-discovery' : 'playwright',
      validated: bug?.validated ?? true,
      confidence,
      consensusCount,
      discoveryPersona,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  writeFileSync(SCORED_PATH, JSON.stringify(scored, null, 2));
  console.log(`\n✅ Scored ${scored.length} findings. Top score: ${scored[0]?.score.toFixed(1) ?? 'N/A'}`);

  // Step 7: Run re-verification on top 10
  await runScript('reverify');
  const finalScored: ScoredBug[] = JSON.parse(readFileSync(SCORED_PATH, 'utf8'));

  // Step 8: Save fingerprints to history
  saveToHistory(finalScored.map((b) => b.fingerprint));

  // Step 9: Build report
  const buffer = await buildDocx(finalScored, {
    crawlDate: DATE,
    totalPages: finalScored.reduce((acc, b) => acc + b.urls.length, 0),
    sites: ['ryzesuperfoods.com', 'shop.ryzesuperfoods.com'],
  });
  const reportPath = join(OUTPUT_DIR, `audit-report-${DATE}.docx`);
  writeFileSync(reportPath, buffer);
  console.log(`\n📄 Report written to ${reportPath}`);

  // Step 10: Print executive summary
  const critical = finalScored.filter((b) => b.severity === 'critical').length;
  const high = finalScored.filter((b) => b.severity === 'high').length;
  const medium = finalScored.filter((b) => b.severity === 'medium').length;
  const low = finalScored.filter((b) => b.severity === 'low').length;
  console.log(`\n📊 Executive Summary:`);
  console.log(`   Critical: ${critical}  High: ${high}  Medium: ${medium}  Low: ${low}`);
  console.log(`   Total findings: ${finalScored.length} (${finalScored.filter((b) => b.source === 'claude-discovery').length} from discovery)`);
}

main().catch((err) => {
  console.error('Orchestrator failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run tsc
```

Expected: no errors. If `buildDocx` signature doesn't accept `ScoredBug[]`, see Task 16.

- [ ] **Step 3: Commit**

```bash
git add scripts/orchestrate.ts
git commit -m "feat: implement main orchestrator (validate + discover + score + reverify + report)"
```

---

### Task 16: Update the docx builder to accept ScoredBug

**Files:**
- Modify: `src/report/docx-builder.ts`

- [ ] **Step 1: Check the current buildDocx signature**

```bash
grep -n "export.*buildDocx\|function buildDocx" src/report/docx-builder.ts
```

Note the current parameter type.

- [ ] **Step 2: Update buildDocx to accept BugRecord | ScoredBug**

The current signature in `src/report/docx-builder.ts:170` is:
```typescript
export async function buildDocx(
  bugs: BugRecord[],
  meta: { crawlDate: string; totalPages: number; sites: string[] },
): Promise<Buffer>
```

Make these two changes:

**Change 1** — update the import at the top of the file:
```typescript
import type { BugRecord, ScoredBug, Severity } from '../types.js';
```

**Change 2** — update the function signature at line 170:
```typescript
export async function buildDocx(
  bugs: (BugRecord | ScoredBug)[],
  meta: { crawlDate: string; totalPages: number; sites: string[] },
): Promise<Buffer> {
```

**Change 3** — in the `children` array, right after `summaryTable(...)`, add a scored summary row if findings have scores. Insert after line ~188 (`summaryTable(counts, meta.totalPages, meta.crawlDate, meta.sites),`):

```typescript
    // Scored pipeline executive summary (only present when orchestrate.ts is used)
    ...(bugs.some((b): b is ScoredBug => 'score' in b) ? (() => {
      const scored = bugs.filter((b): b is ScoredBug => 'score' in b);
      const discovery = scored.filter((b) => b.source === 'claude-discovery').length;
      const verified = scored.filter((b) => b.verificationStatus === 'confirmed').length;
      return [
        new Paragraph({
          spacing: { before: 120, after: 80 },
          children: [
            new TextRun({ text: `AI-discovered findings: ${discovery}  |  Playwright-verified: ${verified}  |  Sorted by business impact score`, size: 18, color: '555555', italics: true }),
          ],
        }),
      ];
    })() : []),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run tsc
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/report/docx-builder.ts
git commit -m "feat: update docx builder to accept ScoredBug and render executive summary"
```

---

### Task 17: Write the orchestrator smoke test

**Files:**
- Create: `tests/smoke/orchestrate.test.ts`
- Create: `tests/fixtures/smoke-bugs.jsonl`

- [ ] **Step 1: Create fixture bug data**

Create `tests/fixtures/smoke-bugs.jsonl` with 3 representative bugs:

```jsonl
{"ruleId":"revenue:no-atc","severity":"critical","bugClass":"revenue","message":"Add to Cart button not found within 15s","url":"https://www.ryzesuperfoods.com/products/ryze-mushroom-coffee","viewport":"desktop","timestamp":"2026-05-05T10:00:00.000Z","validated":true,"confidence":1.0}
{"ruleId":"a11y:color-contrast","severity":"medium","bugClass":"a11y","message":"Element has insufficient color contrast","url":"https://www.ryzesuperfoods.com/blogs/news/some-article","viewport":"mobile","timestamp":"2026-05-05T10:01:00.000Z","validated":true,"confidence":0.8}
{"ruleId":"network:404","severity":"high","bugClass":"network","message":"404 Not Found: https://www.ryzesuperfoods.com/cdn/shop/files/broken-image.png","url":"https://www.ryzesuperfoods.com/","viewport":"desktop","timestamp":"2026-05-05T10:02:00.000Z","validated":true,"confidence":0.9}
```

- [ ] **Step 2: Create tests/smoke/ directory and write the smoke test**

```typescript
// tests/smoke/orchestrate.test.ts
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { deduplicateBugs } from '../../src/dedupe/fingerprint.js';
import { scoreBug } from '../../src/scoring/scorer.js';
import type { BugInstance } from '../../src/types.js';

const FIXTURE_PATH = join(process.cwd(), 'tests/fixtures/smoke-bugs.jsonl');

test('scorer produces revenue bug as top finding', () => {
  const bugs: BugInstance[] = readFileSync(FIXTURE_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BugInstance);

  const ctx = { knownFingerprints: new Set<string>(), confidence: 1.0, consensusCount: 1 };
  const scored = bugs
    .map((b) => ({ bug: b, score: scoreBug(b, { ...ctx, confidence: b.confidence ?? 1.0 }) }))
    .sort((a, b) => b.score - a.score);

  expect(scored[0].bug.bugClass).toBe('revenue');
  expect(scored[0].bug.url).toContain('/products/');
});

test('deduplication does not collapse distinct 404s', () => {
  const bugs: BugInstance[] = readFileSync(FIXTURE_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BugInstance);

  const records = deduplicateBugs(bugs);
  expect(records.length).toBeGreaterThanOrEqual(bugs.length - 1);
});

test('scoring never produces negative scores', () => {
  const bugs: BugInstance[] = readFileSync(FIXTURE_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BugInstance);

  for (const bug of bugs) {
    const score = scoreBug(bug, { knownFingerprints: new Set(['x']), confidence: 0.1, consensusCount: 1 });
    expect(score).toBeGreaterThanOrEqual(0);
  }
});
```

- [ ] **Step 3: Run smoke test**

```bash
npm run test:smoke
```

Expected: all 3 tests PASS.

- [ ] **Step 4: Run all unit and smoke tests together**

```bash
npm run test:unit && npm run test:smoke
```

Expected: all 15 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/orchestrate.test.ts tests/fixtures/smoke-bugs.jsonl
git commit -m "feat: add smoke tests for scorer and deduplication pipeline"
```

---

### Task 18: Final verification and GitHub repo creation

- [ ] **Step 1: Run full type check and all tests**

```bash
npm run tsc && npm run test:unit && npm run test:smoke && npm run lint:personas
```

Expected: all pass with no errors.

- [ ] **Step 2: Verify the git log looks clean**

```bash
git log --oneline -15
```

Expected: a clean sequence of feature commits from this plan.

- [ ] **Step 3: Check GitHub CLI is authenticated**

```bash
gh auth status
```

Expected: shows authenticated account. If not, run `gh auth login`.

- [ ] **Step 4: Create private GitHub repository and push**

```bash
gh repo create ryze-qa-agent --private --source=. --remote=origin --push --description "Automated AI-powered QA agent for ryzesuperfoods.com — Playwright crawl, Claude validation and discovery, scored .docx reports"
```

Expected: creates the repo, sets `origin`, pushes all commits. Prints the repo URL.

- [ ] **Step 5: Verify the repo is live**

```bash
gh repo view ryze-qa-agent
```

Expected: shows repo details, README preview, private visibility confirmed.

- [ ] **Step 6: Open the repo in the browser**

```bash
gh repo view ryze-qa-agent --web
```

Expected: GitHub opens in browser showing the README and all committed files.

---

## Appendix: Environment Variables

| Variable | Required for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `validate`, `discover`, `orchestrate` | Without it, these steps warn and fall back gracefully |

## Appendix: Expected file tree after full implementation

```
personas/
  orchestrator.md
  revenue-hawk.md
  skeptical-first-timer.md
  brand-purist.md
  forensic-technician.md
  dr-marcus-chen.md
scripts/
  crawl.ts           (existing)
  report.ts          (existing)
  validate.ts        (new)
  discover.ts        (new)
  reverify.ts        (new)
  orchestrate.ts     (new)
  dismiss.ts         (new)
  lint-personas.ts   (new)
src/
  scoring/
    scorer.ts        (new)
    evidence-enforcer.ts (new)
  types.ts           (modified)
  report/docx-builder.ts (modified)
tests/
  unit/
    scorer.test.ts   (new)
    evidence-enforcer.test.ts (new)
  smoke/
    orchestrate.test.ts (new)
  fixtures/
    smoke-bugs.jsonl (new)
    claude-responses/
      validation-sample.json (new)
data/
  bugs.jsonl         (gitignored, generated)
  validated-bugs.jsonl (gitignored, generated)
  discoveries.jsonl  (gitignored, generated)
  scored-bugs.json   (gitignored, generated)
  dismissed.jsonl    (gitignored, human-maintained)
  report-history.jsonl (gitignored, generated)
README.md            (new)
```
