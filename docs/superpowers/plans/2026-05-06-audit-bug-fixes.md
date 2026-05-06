# Audit Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all unfixed bugs identified in docs/audit-2026-05-06.md, covering validation integrity, noise filtering, a11y accuracy, deduplication correctness, and report rendering.

**Architecture:** Each fix is isolated to a single file or a pair of files. No new abstractions introduced. All changes are backwards-compatible — existing bugs.jsonl and scored-bugs.json files remain valid. Fixes are committed individually after verification.

**Tech Stack:** TypeScript (tsx), Playwright, axe-core, cspell, sharp-phash, Anthropic SDK

---

## Pre-flight notes

REVY-001, REVY-002, and REVY-004 described in the audit are **already fixed** in the current codebase:
- `reverify.ts` already uses `ruleId.startsWith('axe:')` (not `'a11y:'`)
- `reverify.ts` already sets `bug.elementShot` which `screenshot-cropper.ts` reads
- `verifyBug()` already returns correct `VerificationStatus` values

Do NOT re-fix these. The plan covers only the still-unfixed issues.

---

## File Map

| File | Change |
|------|--------|
| `scripts/orchestrate.ts:170` | `?? true` → `?? false`; add API key warning |
| `scripts/orchestrate.ts:196-205` | Gate summary/category log messages behind `client != null` |
| `tests/checks/a11y.ts` | Add Okendo selectors; add `moderate` severity mapping |
| `tests/checks/content.ts` | Strip soft hyphens before writing cspell tmpfile |
| `tests/checks/network.ts` | Add `NOISE_404_URL_PATTERNS` to suppress stale-theme and Edgemesh 404s at capture time |
| `src/report/html-builder.ts` | Render `verificationStatus` badge in `cardHtml()` |
| `src/report/styles.ts` | Add CSS for verification status badge |
| `src/dedupe/perceptual-hash.ts` | Fix Hamming distance: `parseInt(a[i], 16)` → `a[i] !== b[i] ? 1 : 0` |
| `cspell.json` | Add Spanish dictionary |
| `package.json` | Add `@cspell/dict-es-es` dependency |

---

## Task 1: VALID-001 — Fix `validated ?? true` fallback (CRITICAL)

**Files:**
- Modify: `scripts/orchestrate.ts:65-66,170`

**What:** When `ANTHROPIC_API_KEY` is absent, `matchingBug` is always undefined, so every bug gets `validated: true`. Change the fallback to `false` and emit a startup warning.

- [ ] **Step 1: Edit orchestrate.ts**

In `scripts/orchestrate.ts`, make two changes:

Change at line ~65-66 (after `const client = ...`):
```ts
const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;
if (!client) {
  console.warn('[WARN] ANTHROPIC_API_KEY not set — LLM steps (validate, personas, summaries, categories) will be skipped. Bugs will NOT be marked as AI-validated.');
}
```

Change at line ~170 (inside the `scored` map):
```ts
validated: matchingBug?.validated ?? false,
```

- [ ] **Step 2: Verify change looks correct**

```bash
grep -n 'validated.*matchingBug\|ANTHROPIC_API_KEY' "scripts/orchestrate.ts"
```

Expected output includes:
- `validated: matchingBug?.validated ?? false,`
- The `[WARN]` console.warn line

- [ ] **Step 3: Commit**

```bash
git add scripts/orchestrate.ts
git commit -m "fix: VALID-001 — validated defaults false when API key absent"
```

---

## Task 2: VALID-002 — Gate misleading log messages (LOW)

**Files:**
- Modify: `scripts/orchestrate.ts:195-205`

**What:** The "Generating summaries…" and "Assigning categories…" logs fire even when `client` is null and both steps are skipped.

- [ ] **Step 1: Edit orchestrate.ts**

Replace the summary + category section (currently ~lines 195-205):

```ts
// Step 10a: Generate plain-English summaries
const withSummaries = client
  ? (console.log('\n✍️  Generating summaries...'), await generateSummaries(client, finalScored))
  : (console.log('\n⏭️  Skipping summaries (no API key).'), finalScored);

// Step 10b: Assign categories
const withCategories = client
  ? (console.log('\n🏷️  Assigning categories...'), await assignCategories(client, withSummaries))
  : (console.log('\n⏭️  Skipping categories (no API key).'), withSummaries);
```

- [ ] **Step 2: Verify**

```bash
grep -n 'Generating summaries\|Assigning categories\|Skipping' "scripts/orchestrate.ts"
```

Expected: both log lines are now inside the ternary.

- [ ] **Step 3: Commit**

```bash
git add scripts/orchestrate.ts
git commit -m "fix: VALID-002 — gate summary/category logs behind API key check"
```

---

## Task 3: AXE-001 — Add Okendo widget to axe exclusions (HIGH)

**Files:**
- Modify: `tests/checks/a11y.ts:7-12`

**What:** Okendo review widget DOM generates dozens of false WCAG violations per product page. Add its selectors to `EXCLUDED_SELECTORS`.

- [ ] **Step 1: Edit a11y.ts**

Replace the `EXCLUDED_SELECTORS` array:

```ts
const EXCLUDED_SELECTORS = [
  'iframe[src*="klaviyo"]',
  '#gorgias-chat-container',
  '#fb-root',
  '[id*="tiktok"]',
  '[data-okendo-initialized]',
  '[class*="okeReviews"]',
  '#okendo-reviews-widget',
];
```

- [ ] **Step 2: Verify**

```bash
grep -n 'okendo\|okeReviews\|EXCLUDED_SELECTORS' "tests/checks/a11y.ts"
```

Expected: three Okendo entries visible.

- [ ] **Step 3: Commit**

```bash
git add tests/checks/a11y.ts
git commit -m "fix: AXE-001 — exclude Okendo review widget from axe scans"
```

---

## Task 4: AXE-002 — Add `moderate` severity mapping (MEDIUM)

**Files:**
- Modify: `tests/checks/a11y.ts:28-32`

**What:** axe's four impact levels are `critical | serious | moderate | minor`. The current severity mapping handles `critical`, `serious`, and (implicitly via else) `minor`/`moderate` both as `medium`. This is actually mostly correct — but the audit noted that `moderate` was being silently dropped. Looking at the actual code, `moderate` falls through to the else branch and becomes `medium`. This IS being captured. However, to be explicit and avoid future confusion, add a comment or make the mapping explicit.

Actually re-reading `a11y.ts`:
```ts
const severity =
  impact === 'critical' || impact === 'serious'
    ? ('high' as const)
    : ('medium' as const);
```

`moderate` → `medium` via the else branch. The audit said moderate was "silently dropped" but looking at the code, it's mapped to `medium`. The code is actually correct. The audit description was based on a different version.

**Conclusion:** AXE-002 is already handled correctly — moderate maps to medium via the else branch. Skip this task.

---

## Task 5: SPELL-001 — Strip soft hyphens before cspell (HIGH)

**Files:**
- Modify: `tests/checks/content.ts:52-53`

**What:** Soft-hyphen `U+00AD` characters in CMS content split words during cspell analysis, causing silent misses or false positives.

- [ ] **Step 1: Edit content.ts**

After `if (!text.trim()) return;`, add a sanitization step before writing the tmpfile. Specifically, replace the `writeFileSync(tmpFile, text)` line with:

```ts
const sanitized = text.replace(/­/g, ''); // strip soft hyphens — U+00AD splits words in cspell
writeFileSync(tmpFile, sanitized);
```

- [ ] **Step 2: Verify**

```bash
grep -n 'u00AD\|soft\|sanitized' "tests/checks/content.ts"
```

Expected: the `­` replacement line visible.

- [ ] **Step 3: Commit**

```bash
git add tests/checks/content.ts
git commit -m "fix: SPELL-001 — strip soft hyphens before cspell analysis"
```

---

## Task 6: SPELL-002 — Add Spanish dictionary to cspell (CRITICAL)

**Files:**
- Modify: `package.json`
- Modify: `cspell.json`

**What:** Spanish-language content blocks (testimonials, CMS) generate a noise storm of false `content:typo` findings because cspell only knows `en-US`.

- [ ] **Step 1: Install the dictionary**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npm install --save-dev @cspell/dict-es-es
```

Expected: package installs without error. `package.json` now lists `@cspell/dict-es-es` in devDependencies.

- [ ] **Step 2: Update cspell.json**

Replace the `dictionaries` and `dictionaryDefinitions` sections:

```json
{
  "version": "0.2",
  "language": "en,es",
  "dictionaryDefinitions": [
    {
      "name": "ryze-brand",
      "path": "./data/brand-dictionary.txt",
      "addWords": true
    }
  ],
  "dictionaries": ["en_US", "es_ES", "ryze-brand"],
  "minWordLength": 5,
  "ignoreRegExpList": [
    "\\b[A-Z][a-z]+ [A-Z]\\.",
    "^[A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+$",
    "[áéíóúñüÁÉÍÓÚÑÜ]"
  ],
  "ignorePaths": [
    "node_modules",
    "output",
    "dist",
    "data/bugs.jsonl"
  ]
}
```

- [ ] **Step 3: Verify the dictionary loads**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && echo "gracias salud bienestar" | npx cspell stdin --config cspell.json --no-progress
```

Expected: no typo warnings (Spanish words should pass).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json cspell.json
git commit -m "fix: SPELL-002 — add Spanish dictionary to cspell config"
```

---

## Task 7: NET-002 — Add capture-time noise filters to network.ts (HIGH)

**Files:**
- Modify: `tests/checks/network.ts:20`

**What:** Stale-theme CDN 404s (`/t/NNN/` where NNN ≠ 2676) and Edgemesh paths are filtered post-hoc in `report.ts` but written into `bugs.jsonl` on every run. Adding the same patterns at capture time eliminates them from the raw data.

- [ ] **Step 1: Edit network.ts**

Add `NOISE_404_URL_PATTERNS` constant and expand `isNoise` to use it for 404 responses:

```ts
const NOISE_404_URL_PATTERNS = [
  /\/em-prerender/,
  /\/em-cgi\//,
  /\/em-js\//,
  /cdn\.shopify\.com\/s\/files\/.*\/t\/(?!2676\/)[0-9]+\//,
  /\/t\?event=/,
];

function isNoise(url: string, statusCode?: number): boolean {
  try {
    const host = new URL(url).hostname;
    if (NOISE_HOSTS.some((d) => host.endsWith(d))) return true;
    if (NOISE_URL_PATTERNS.some((p) => url.includes(p))) return true;
    if (statusCode === 404 && NOISE_404_URL_PATTERNS.some((p) => p.test(url))) return true;
    return false;
  } catch { return false; }
}
```

Then update the `response` listener to pass the status code:

```ts
page.on('response', (res) => {
  if (res.status() < 400) return;
  if (isNoise(res.url(), res.status())) return;
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
```

Also update the `requestfailed` call to pass `undefined` as statusCode (keeps the signature consistent):

```ts
page.on('requestfailed', (req) => {
  if (isNoise(req.url(), undefined)) return;
  // ... rest unchanged
```

- [ ] **Step 2: Verify**

```bash
grep -n 'NOISE_404_URL_PATTERNS\|isNoise\|2676' "tests/checks/network.ts"
```

Expected: `NOISE_404_URL_PATTERNS` array and its use in `isNoise` visible.

- [ ] **Step 3: Commit**

```bash
git add tests/checks/network.ts
git commit -m "fix: NET-002 — add capture-time noise filters for stale-theme and Edgemesh 404s"
```

---

## Task 8: REVY-003 — Render verificationStatus in report cards (HIGH)

**Files:**
- Modify: `src/report/html-builder.ts:36-59`
- Modify: `src/report/styles.ts`

**What:** `verificationStatus` is computed by `reverify.ts` and stored in `scored-bugs.json` but `cardHtml()` never renders it. Confirmed and resolved bugs look identical to unverified bugs.

- [ ] **Step 1: Check styles.ts for existing badge patterns**

```bash
grep -n 'badge\|verification\|confirmed\|resolved' "src/report/styles.ts" | head -20
```

- [ ] **Step 2: Add verification badge CSS to styles.ts**

Find the `.badge` CSS in `styles.ts` and append the verification status styles after it. Add this to the STYLES string:

```css
.verify-badge { display: inline-block; font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 10px; margin-left: 6px; vertical-align: middle; }
.verify-badge.confirmed { background: #d1fae5; color: #065f46; }
.verify-badge.could-not-reproduce { background: #fee2e2; color: #991b1b; }
.verify-badge.inconclusive { background: #fef3c7; color: #92400e; }
```

- [ ] **Step 3: Edit cardHtml() to render the badge**

In `src/report/html-builder.ts`, update `cardHtml()` to add the verification badge in the `card-header` div. Replace the `card-header` section:

```ts
const verifyBadge = bug.verificationStatus && bug.verificationStatus !== 'unverified'
  ? `<span class="verify-badge ${escapeHtml(bug.verificationStatus)}">${escapeHtml(
      bug.verificationStatus === 'confirmed' ? '✓ Confirmed'
      : bug.verificationStatus === 'could-not-reproduce' ? '✗ Could not reproduce'
      : '? Inconclusive'
    )}</span>`
  : '';

return `<div class="card" data-severity="${bug.severity}">
  <div class="card-header">
    <span class="badge ${bug.severity}">${escapeHtml(SEVERITY_LABEL[bug.severity].toUpperCase())}</span>
    <code class="rule-id">${escapeHtml(bug.ruleId)}</code>
    ${verifyBadge}
  </div>
  <p class="summary">${summary}</p>
  <div class="urls">
    <div class="urls-label">Affected pages (${bug.urls.length})</div>
    ${urlListHtml(bug.urls)}
  </div>
  ${screenshotHtml}
</div>`;
```

- [ ] **Step 4: Verify**

```bash
grep -n 'verificationStatus\|verify-badge\|verifyBadge' "src/report/html-builder.ts" "src/report/styles.ts"
```

Expected: references in both files.

- [ ] **Step 5: Commit**

```bash
git add src/report/html-builder.ts src/report/styles.ts
git commit -m "fix: REVY-003 — render verificationStatus badge in report cards"
```

---

## Task 9: DEDUP-002 — Fix Hamming distance calculation (MEDIUM)

**Files:**
- Modify: `src/dedupe/perceptual-hash.ts:24`

**What:** The Hamming distance function uses `parseInt(a[i], 16)` to parse binary string characters. For a 64-char binary string (`'0'`/`'1'`), this accidentally produces the right answer today but is semantically wrong and will break if the hash format ever changes to true hex. Replace with direct character comparison.

- [ ] **Step 1: Edit perceptual-hash.ts**

Replace the `hammingDistance` function body:

```ts
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance;
}
```

- [ ] **Step 2: Verify**

```bash
grep -n 'parseInt\|hammingDistance\|distance' "src/dedupe/perceptual-hash.ts"
```

Expected: no `parseInt` in `hammingDistance`. The loop uses `a[i] !== b[i]`.

- [ ] **Step 3: Commit**

```bash
git add src/dedupe/perceptual-hash.ts
git commit -m "fix: DEDUP-002 — correct Hamming distance for binary dHash strings"
```

---

## Task 10: Setup .env and end-to-end test

**What:** Wire the API key into the project and verify the orchestrate pipeline runs end-to-end with LLM steps active.

- [ ] **Step 1: Create .env file**

When the user provides the API key, create `.env` at project root:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Verify it's in `.gitignore`:

```bash
grep '\.env' "/Users/ryzeuser/Claude Code/QA Agent/.gitignore"
```

If not present, add it:

```bash
echo ".env" >> "/Users/ryzeuser/Claude Code/QA Agent/.gitignore"
```

- [ ] **Step 2: Smoke-test validate step in isolation**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npx tsx scripts/validate.ts 2>&1 | head -30
```

Expected: LLM validation runs (not immediate no-op exit). Should see bug count and model calls.

- [ ] **Step 3: Smoke-test orchestrate (requires existing bugs.jsonl)**

If `data/bugs.jsonl` exists from a prior run:

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npm run orchestrate 2>&1 | tail -30
```

Expected:
- No `[WARN] ANTHROPIC_API_KEY not set` message
- `✍️  Generating summaries...` appears (not `⏭️  Skipping`)
- Final report written to `output/audit-report-<date>.html`

- [ ] **Step 4: Verify `validated` field in scored output**

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('data/scored-bugs.json','utf8'));
const pct = d.filter(b=>b.validated===true).length/d.length*100;
console.log('validated:true pct:', pct.toFixed(1)+'%');
console.log('sample validated values:', d.slice(0,5).map(b=>b.validated));
"
```

Expected: `validated: false` for bugs where LLM validation ran and didn't confirm them, `true` only for bugs the LLM explicitly validated.

---

## Task 11: Update CLAUDE.md to reflect fixed bugs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `scripts/CLAUDE.md`

**What:** The CLAUDE.md gotchas section still lists REVY-001, REVY-002, REVY-004 as unfixed. They're already fixed. Update to reflect current state so future sessions aren't misled.

- [ ] **Step 1: Edit CLAUDE.md**

In the `## Key gotchas` section, update or remove these entries:
- Remove the `reverify.ts is broken in 3 independent ways` note (REVY-001, REVY-002, REVY-004 are fixed)
- Update the `Okendo review widget not excluded from axe (AXE-001, UNFIXED)` note to `(FIXED)`
- Update the `No Spanish dictionary in cspell (SPELL-002, UNFIXED)` note to `(FIXED)`
- Update the `validated: true default when ANTHROPIC_API_KEY is absent (VALID-001, UNFIXED)` note to `(FIXED)`
- Update the `axe:moderate violations silently dropped (AXE-002, UNFIXED)` note — AXE-002 is already handled by the else branch; mark as `(NOT A BUG — moderate maps to medium via else branch)`

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md scripts/CLAUDE.md
git commit -m "docs: update CLAUDE.md gotchas to reflect fixed audit findings"
```

---

## Self-Review

**Spec coverage check:**
- VALID-001 ✓ Task 1
- VALID-002 ✓ Task 2
- AXE-001 ✓ Task 3
- AXE-002 — already correct, no fix needed (else branch handles moderate→medium)
- SPELL-001 ✓ Task 5
- SPELL-002 ✓ Task 6
- NET-002 ✓ Task 7
- REVY-003 ✓ Task 8
- REVY-001, REVY-002, REVY-004 — already fixed, documented in pre-flight notes
- DEDUP-002 ✓ Task 9
- DEDUP-001 (wire dHash) — LOW, not included; activate when visual.ts populates dHash
- End-to-end test ✓ Task 10
- Docs update ✓ Task 11

**Placeholder scan:** No TBD or TODO entries. All code blocks are complete.

**Type consistency:** `bug.verificationStatus` is typed as `VerificationStatus | undefined` on `ScoredBug`. The badge template handles all four values (`confirmed`, `could-not-reproduce`, `inconclusive`, and `unverified` via the falsy guard).
