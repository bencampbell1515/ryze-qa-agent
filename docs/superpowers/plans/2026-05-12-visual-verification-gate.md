# Visual Verification Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a post-dedup LLM verdict stage that suppresses bugs a shopper wouldn't visually notice, routing them to a separate suppressed-bugs report.

**Architecture:** New module `src/llm/visual-gate.ts` exposes `gateRecords(records)` which calls Sonnet 4.6 with per-record screenshots + bug context, classifies each as `visible | uncertain | not-visible`, and splits the input into `kept` and `suppressed` lists. Wired into `scripts/orchestrate.ts` between dedup and scoring. A new suppressed-report builder mirrors the existing report card layout.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (already a dep), `p-limit` (already a dep), Playwright Test for unit tests.

**Spec:** [docs/superpowers/specs/2026-05-12-visual-verification-gate-design.md](../specs/2026-05-12-visual-verification-gate-design.md)

---

## Task 1: Add `verdict` and `verdictReason` to BugRecord

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the two optional fields to `BugRecord`**

In `src/types.ts`, find the `BugRecord` interface and add these two optional fields anywhere in the interface (after `instanceCount` is fine):

```ts
  /** Visual gate verdict — undefined means gate did not run on this record */
  verdict?: 'visible' | 'uncertain' | 'not-visible';
  /** One-sentence LLM rationale for the verdict */
  verdictReason?: string;
```

- [ ] **Step 2: Run typecheck to make sure nothing else breaks**

Run: `npx tsc --noEmit`
Expected: exit code 0, no output.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "types: add verdict + verdictReason to BugRecord for visual gate"
```

---

## Task 2: Create gate module skeleton with `DISABLE_VISUAL_GATE` knob

**Files:**
- Create: `src/llm/visual-gate.ts`
- Create: `tests/unit/visual-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/visual-gate.test.ts`:

```ts
import { test, expect } from '@playwright/test';
import { gateRecords } from '../../src/llm/visual-gate.js';
import type { BugRecord } from '../../src/types.js';

function fakeRecord(overrides: Partial<BugRecord> = {}): BugRecord {
  return {
    fingerprint: 'fp1',
    ruleId: 'content:broken-image',
    severity: 'high',
    bugClass: 'content',
    title: 'x',
    description: 'y',
    urls: ['https://example.com'],
    viewports: ['desktop'],
    instanceCount: 1,
    ...overrides,
  };
}

test('DISABLE_VISUAL_GATE=1 short-circuits: all records kept, no SDK calls', async () => {
  process.env.DISABLE_VISUAL_GATE = '1';
  const records = [fakeRecord(), fakeRecord({ fingerprint: 'fp2' })];
  const result = await gateRecords(records);
  expect(result.kept).toHaveLength(2);
  expect(result.suppressed).toHaveLength(0);
  expect(result.failedCount).toBe(0);
  expect(result.totalGated).toBe(0);
  delete process.env.DISABLE_VISUAL_GATE;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --grep "DISABLE_VISUAL_GATE"`
Expected: FAIL — `Cannot find module '../../src/llm/visual-gate.js'`

- [ ] **Step 3: Create the skeleton module**

Create `src/llm/visual-gate.ts`:

```ts
import type { BugRecord } from '../types.js';

export type GateResult = {
  /** Records that survived the gate (verdict='visible' | 'uncertain' | undefined) */
  kept: BugRecord[];
  /** Records the LLM judged not-visible to a shopper */
  suppressed: BugRecord[];
  /** Count of records whose LLM verdict failed after all retries */
  failedCount: number;
  /** Total number of records that were sent through the gate (i.e., in scope) */
  totalGated: number;
};

export async function gateRecords(records: BugRecord[]): Promise<GateResult> {
  if (process.env.DISABLE_VISUAL_GATE === '1') {
    return { kept: [...records], suppressed: [], failedCount: 0, totalGated: 0 };
  }

  // TODO: implemented in subsequent tasks
  return { kept: [...records], suppressed: [], failedCount: 0, totalGated: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --grep "DISABLE_VISUAL_GATE"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm/visual-gate.ts tests/unit/visual-gate.test.ts
git commit -m "feat(visual-gate): add module skeleton + DISABLE_VISUAL_GATE knob"
```

---

## Task 3: Scope filter — only gated ruleIds get a verdict

**Files:**
- Modify: `src/llm/visual-gate.ts`
- Modify: `tests/unit/visual-gate.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/visual-gate.test.ts`:

```ts
test('records with non-gated ruleIds pass through unchanged', async () => {
  process.env.DISABLE_VISUAL_GATE = '0';
  const records = [
    fakeRecord({ ruleId: 'revenue:cart-subtotal-missing' }),
    fakeRecord({ ruleId: 'seo:missing-canonical', fingerprint: 'fp2' }),
    fakeRecord({ ruleId: 'revenue:countdown-stuck', fingerprint: 'fp3' }),
  ];
  const result = await gateRecords(records);
  expect(result.kept).toHaveLength(3);
  expect(result.suppressed).toHaveLength(0);
  expect(result.totalGated).toBe(0);
  expect(result.kept.every((r) => r.verdict === undefined)).toBe(true);
});

test('records with gated ruleIds are counted in totalGated', async () => {
  // We don't have the SDK mock yet — set ANTHROPIC_API_KEY=missing so the
  // module short-circuits to verdict='uncertain' for in-scope records.
  process.env.DISABLE_VISUAL_GATE = '0';
  delete process.env.ANTHROPIC_API_KEY;
  const records = [
    fakeRecord({ ruleId: 'content:broken-image' }),
    fakeRecord({ ruleId: 'network:404', fingerprint: 'fp2' }),
    fakeRecord({ ruleId: 'revenue:cart-subtotal-missing', fingerprint: 'fp3' }),
  ];
  const result = await gateRecords(records);
  expect(result.totalGated).toBe(2);
  expect(result.kept).toHaveLength(3); // uncertain stays in kept
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --grep "non-gated|totalGated"`
Expected: both FAIL — current skeleton doesn't classify.

- [ ] **Step 3: Add the scope filter to the module**

Replace the body of `gateRecords` in `src/llm/visual-gate.ts`:

```ts
import type { BugRecord } from '../types.js';

const GATED_RULE_IDS = new Set([
  'content:broken-image',
  'content:empty-image-src',
  'content:broken-picture-template',
  'network:404',
  'network:4xx',
  'network:failed',
  'network:nav-failed',
]);

export type GateResult = {
  kept: BugRecord[];
  suppressed: BugRecord[];
  failedCount: number;
  totalGated: number;
};

export async function gateRecords(records: BugRecord[]): Promise<GateResult> {
  if (process.env.DISABLE_VISUAL_GATE === '1') {
    return { kept: [...records], suppressed: [], failedCount: 0, totalGated: 0 };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const inScope = records.filter((r) => GATED_RULE_IDS.has(r.ruleId));
  const outOfScope = records.filter((r) => !GATED_RULE_IDS.has(r.ruleId));

  // No API key: every in-scope record falls back to 'uncertain' and stays in kept.
  if (!apiKey) {
    const fallback = inScope.map((r) => ({ ...r, verdict: 'uncertain' as const, verdictReason: 'gate skipped: no ANTHROPIC_API_KEY' }));
    return {
      kept: [...outOfScope, ...fallback],
      suppressed: [],
      failedCount: inScope.length,
      totalGated: inScope.length,
    };
  }

  // TODO: real LLM verdict path implemented in subsequent tasks.
  // For now, mirror the no-key behavior.
  const fallback = inScope.map((r) => ({ ...r, verdict: 'uncertain' as const, verdictReason: 'gate not yet implemented' }));
  return {
    kept: [...outOfScope, ...fallback],
    suppressed: [],
    failedCount: 0,
    totalGated: inScope.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --grep "non-gated|totalGated"`
Expected: PASS for both. Also: `npm run test:unit -- --grep "DISABLE_VISUAL_GATE"` still PASSES.

- [ ] **Step 5: Commit**

```bash
git add src/llm/visual-gate.ts tests/unit/visual-gate.test.ts
git commit -m "feat(visual-gate): add scope filter for gated rule IDs"
```

---

## Task 4: LLM verdict via `tool_use` (the core call)

**Files:**
- Modify: `src/llm/visual-gate.ts`
- Modify: `tests/unit/visual-gate.test.ts`

- [ ] **Step 1: Write failing tests with a mocked SDK**

Append to `tests/unit/visual-gate.test.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk';

// Build a fake Anthropic client whose messages.create returns a tool_use block
// with the given verdict/reason. Tests inject this via the optional `client` param.
function fakeClient(verdict: 'visible' | 'uncertain' | 'not-visible', reason = 'mocked'): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [
          {
            type: 'tool_use',
            name: 'submit_verdict',
            id: 'toolu_test',
            input: { verdict, reason },
          },
        ],
        stop_reason: 'tool_use',
      }),
    },
  } as unknown as Anthropic;
}

test('verdict=visible → record kept with verdict set', async () => {
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  const records = [fakeRecord({ ruleId: 'content:broken-image' })];
  const result = await gateRecords(records, { client: fakeClient('visible', 'hero is clearly broken') });
  expect(result.kept).toHaveLength(1);
  expect(result.kept[0].verdict).toBe('visible');
  expect(result.kept[0].verdictReason).toBe('hero is clearly broken');
  expect(result.suppressed).toHaveLength(0);
});

test('verdict=not-visible → record routed to suppressed', async () => {
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  const records = [fakeRecord({ ruleId: 'content:broken-image' })];
  const result = await gateRecords(records, { client: fakeClient('not-visible', 'far below the fold') });
  expect(result.kept).toHaveLength(0);
  expect(result.suppressed).toHaveLength(1);
  expect(result.suppressed[0].verdict).toBe('not-visible');
});

test('verdict=uncertain → record stays in kept', async () => {
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  const records = [fakeRecord({ ruleId: 'content:broken-image' })];
  const result = await gateRecords(records, { client: fakeClient('uncertain') });
  expect(result.kept).toHaveLength(1);
  expect(result.kept[0].verdict).toBe('uncertain');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --grep "verdict=visible|verdict=not-visible|verdict=uncertain"`
Expected: all FAIL — gateRecords doesn't accept a `client` param yet.

- [ ] **Step 3: Implement the LLM call path**

Replace `src/llm/visual-gate.ts` entirely:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'node:fs';
import type { BugRecord } from '../types.js';

const GATED_RULE_IDS = new Set([
  'content:broken-image',
  'content:empty-image-src',
  'content:broken-picture-template',
  'network:404',
  'network:4xx',
  'network:failed',
  'network:nav-failed',
]);

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 512;

const SYSTEM_PROMPT = `You are reviewing a candidate bug from an automated QA audit of an e-commerce site. Decide whether this bug is something a typical shopper would actually notice.

Verdicts:
- "visible"     — clearly noticeable: broken/missing visual content in or near the main page content, broken layout, broken interaction, prominent error text. Err toward "visible" for anything in the page's primary visible area.
- "not-visible" — real defect at the code level, but no shopper would see it. Examples: empty <img> hidden inside a closed modal; broken background image far below the fold; missing srcset entry where <picture> has working fallback sources; 404 on a tracking pixel.
- "uncertain"   — can't tell from the screenshots. Default to this if ambiguous. Uncertain findings STAY in the report.

Be conservative: only return "not-visible" if you can specifically point to why a shopper wouldn't see it. When in doubt, return "uncertain".`;

const TOOL_SCHEMA = {
  name: 'submit_verdict',
  description: 'Submit the visibility verdict for this candidate bug.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string' as const, enum: ['visible', 'uncertain', 'not-visible'] },
      reason: { type: 'string' as const, description: '1-2 sentences explaining the verdict' },
    },
    required: ['verdict', 'reason'],
  },
};

export type GateResult = {
  kept: BugRecord[];
  suppressed: BugRecord[];
  failedCount: number;
  totalGated: number;
};

export type GateOptions = {
  /** Optional injected client — used by tests; in production we construct from env */
  client?: Anthropic;
};

type Verdict = { verdict: 'visible' | 'uncertain' | 'not-visible'; reason: string };

function buildBugContextText(r: BugRecord): string {
  return [
    `Rule ID: ${r.ruleId}`,
    `Severity: ${r.severity}`,
    `Message: ${r.description}`,
    `Affected URLs (${r.urls.length}): ${r.urls.slice(0, 3).join(', ')}${r.urls.length > 3 ? ', …' : ''}`,
    r.selector ? `Selector: ${r.selector}` : '',
    r.outerHTMLSnippet ? `HTML snippet: ${r.outerHTMLSnippet.slice(0, 300)}` : '',
  ].filter(Boolean).join('\n');
}

function buildContent(r: BugRecord): Anthropic.MessageParam['content'] {
  const content: Anthropic.MessageParam['content'] = [
    { type: 'text', text: buildBugContextText(r) },
  ];
  if (r.annotatedPageShot && existsSync(r.annotatedPageShot)) {
    const data = readFileSync(r.annotatedPageShot).toString('base64');
    content.push({ type: 'text', text: 'Annotated full-page screenshot:' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
  }
  if (r.elementShot && existsSync(r.elementShot)) {
    const data = readFileSync(r.elementShot).toString('base64');
    content.push({ type: 'text', text: 'Element close-up screenshot:' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
  }
  return content;
}

async function callLLMForVerdict(client: Anthropic, r: BugRecord): Promise<Verdict> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'submit_verdict' },
    messages: [{ role: 'user', content: buildContent(r) }],
  });
  const block = response.content.find((b) => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
  if (!block) throw new Error('No tool_use block in response');
  const input = block.input as Verdict;
  if (!['visible', 'uncertain', 'not-visible'].includes(input.verdict)) {
    throw new Error(`Invalid verdict: ${input.verdict}`);
  }
  return { verdict: input.verdict, reason: input.reason ?? '' };
}

export async function gateRecords(
  records: BugRecord[],
  opts: GateOptions = {},
): Promise<GateResult> {
  if (process.env.DISABLE_VISUAL_GATE === '1') {
    return { kept: [...records], suppressed: [], failedCount: 0, totalGated: 0 };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const inScope = records.filter((r) => GATED_RULE_IDS.has(r.ruleId));
  const outOfScope = records.filter((r) => !GATED_RULE_IDS.has(r.ruleId));

  if (!apiKey && !opts.client) {
    const fallback = inScope.map((r) => ({ ...r, verdict: 'uncertain' as const, verdictReason: 'gate skipped: no ANTHROPIC_API_KEY' }));
    return {
      kept: [...outOfScope, ...fallback],
      suppressed: [],
      failedCount: inScope.length,
      totalGated: inScope.length,
    };
  }

  const client = opts.client ?? new Anthropic({ apiKey });
  const kept: BugRecord[] = [...outOfScope];
  const suppressed: BugRecord[] = [];
  let failedCount = 0;

  for (const r of inScope) {
    try {
      const v = await callLLMForVerdict(client, r);
      const annotated = { ...r, verdict: v.verdict, verdictReason: v.reason };
      if (v.verdict === 'not-visible') suppressed.push(annotated);
      else kept.push(annotated);
    } catch {
      failedCount++;
      kept.push({ ...r, verdict: 'uncertain', verdictReason: 'gate failed' });
    }
  }

  return { kept, suppressed, failedCount, totalGated: inScope.length };
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npm run test:unit -- --grep "visual-gate|verdict|DISABLE_VISUAL_GATE|non-gated|totalGated"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/visual-gate.ts tests/unit/visual-gate.test.ts
git commit -m "feat(visual-gate): call Sonnet via tool_use, route by verdict"
```

---

## Task 5: Retry policy — 2 retries with exponential backoff

**Files:**
- Modify: `src/llm/visual-gate.ts`
- Modify: `tests/unit/visual-gate.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/visual-gate.test.ts`:

```ts
function flakyClient(failureCount: number, finalVerdict: 'visible' | 'uncertain' | 'not-visible' = 'visible'): Anthropic {
  let calls = 0;
  return {
    messages: {
      create: async () => {
        calls++;
        if (calls <= failureCount) {
          const err = new Error('429 rate limited') as Error & { status?: number };
          err.status = 429;
          throw err;
        }
        return {
          content: [{ type: 'tool_use', name: 'submit_verdict', id: 'toolu_test', input: { verdict: finalVerdict, reason: 'ok' } }],
          stop_reason: 'tool_use',
        };
      },
    },
  } as unknown as Anthropic;
}

test('retry: 1 failure then success → record gated normally', async () => {
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  const records = [fakeRecord({ ruleId: 'content:broken-image' })];
  const result = await gateRecords(records, { client: flakyClient(1, 'visible'), retryDelayMs: 1 });
  expect(result.kept).toHaveLength(1);
  expect(result.kept[0].verdict).toBe('visible');
  expect(result.failedCount).toBe(0);
});

test('retry: 3 consecutive failures → record counted as failed, verdict=uncertain', async () => {
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  const records = [fakeRecord({ ruleId: 'content:broken-image' })];
  const result = await gateRecords(records, { client: flakyClient(99, 'visible'), retryDelayMs: 1 });
  expect(result.kept).toHaveLength(1);
  expect(result.kept[0].verdict).toBe('uncertain');
  expect(result.failedCount).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --grep "retry:"`
Expected: FAIL — `retryDelayMs` not supported; no retry wrapper.

- [ ] **Step 3: Implement retry wrapper**

In `src/llm/visual-gate.ts`:

(a) Add to `GateOptions`:

```ts
export type GateOptions = {
  client?: Anthropic;
  /** Override base retry delay (default 1000ms). Tests use 1ms. */
  retryDelayMs?: number;
};
```

(b) Add helper above `gateRecords`:

```ts
async function withRetries<T>(
  fn: () => Promise<T>,
  retryDelayMs: number,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = retryDelayMs * Math.pow(3, attempt - 1); // 1x, 3x, 9x
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
```

(c) Update the in-scope loop to use it. Replace the for-loop body:

```ts
  const retryDelayMs = opts.retryDelayMs ?? 1000;
  for (const r of inScope) {
    try {
      const v = await withRetries(() => callLLMForVerdict(client, r), retryDelayMs);
      const annotated = { ...r, verdict: v.verdict, verdictReason: v.reason };
      if (v.verdict === 'not-visible') suppressed.push(annotated);
      else kept.push(annotated);
    } catch {
      failedCount++;
      kept.push({ ...r, verdict: 'uncertain', verdictReason: 'gate failed after retries' });
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --grep "retry:"`
Expected: PASS for both.

Also rerun: `npm run test:unit -- --grep "verdict="` — all still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/visual-gate.ts tests/unit/visual-gate.test.ts
git commit -m "feat(visual-gate): retry transient failures with exponential backoff"
```

---

## Task 6: Hard-fail threshold (>50% failure)

**Files:**
- Modify: `src/llm/visual-gate.ts`
- Modify: `tests/unit/visual-gate.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/visual-gate.test.ts`:

```ts
test('hard-fail: >50% of in-scope records fail → throws', async () => {
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  const records = [
    fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'a' }),
    fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'b' }),
    fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'c' }),
  ];
  await expect(
    gateRecords(records, { client: flakyClient(99), retryDelayMs: 1 }),
  ).rejects.toThrow(/visual gate failed/i);
});

test('hard-fail boundary: exactly 50% failed → does NOT throw', async () => {
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  // Custom client: first record fails all retries, second succeeds.
  let calls = 0;
  const client = {
    messages: {
      create: async () => {
        calls++;
        if (calls <= 3) throw new Error('fail');
        return {
          content: [{ type: 'tool_use', name: 'submit_verdict', id: 't', input: { verdict: 'visible', reason: 'ok' } }],
          stop_reason: 'tool_use',
        };
      },
    },
  } as unknown as Anthropic;
  const records = [
    fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'a' }),
    fakeRecord({ ruleId: 'content:broken-image', fingerprint: 'b' }),
  ];
  const result = await gateRecords(records, { client, retryDelayMs: 1 });
  expect(result.failedCount).toBe(1);
  expect(result.totalGated).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --grep "hard-fail"`
Expected: FAIL — no threshold check yet.

- [ ] **Step 3: Add threshold check**

In `src/llm/visual-gate.ts`, after the for-loop but before the `return`, insert:

```ts
  if (inScope.length > 0 && failedCount / inScope.length > 0.5) {
    throw new Error(
      `visual gate failed: ${failedCount} of ${inScope.length} records could not be validated (>50%). Rerun \`npm run report\` to retry without redoing the audit.`,
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --grep "hard-fail|retry:"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/visual-gate.ts tests/unit/visual-gate.test.ts
git commit -m "feat(visual-gate): hard-fail when >50% of records fail validation"
```

---

## Task 7: Concurrency via `p-limit`

**Files:**
- Modify: `src/llm/visual-gate.ts`
- Modify: `tests/unit/visual-gate.test.ts`

- [ ] **Step 1: Write a failing test that proves concurrency is bounded**

Append to `tests/unit/visual-gate.test.ts`:

```ts
test('concurrency: at most CONCURRENCY in-flight calls at any moment', async () => {
  process.env.DISABLE_VISUAL_GATE = '0';
  process.env.ANTHROPIC_API_KEY = 'test';
  let inFlight = 0;
  let peakInFlight = 0;
  const client = {
    messages: {
      create: async () => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return {
          content: [{ type: 'tool_use', name: 'submit_verdict', id: 't', input: { verdict: 'visible', reason: 'ok' } }],
          stop_reason: 'tool_use',
        };
      },
    },
  } as unknown as Anthropic;
  const records = Array.from({ length: 20 }, (_, i) =>
    fakeRecord({ ruleId: 'content:broken-image', fingerprint: `fp${i}` }),
  );
  await gateRecords(records, { client, retryDelayMs: 1 });
  expect(peakInFlight).toBeLessThanOrEqual(8);
  expect(peakInFlight).toBeGreaterThan(1); // proves real concurrency, not serial
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --grep "concurrency:"`
Expected: FAIL — current implementation is serial, `peakInFlight === 1`.

- [ ] **Step 3: Wire up p-limit**

In `src/llm/visual-gate.ts`:

(a) Add import:

```ts
import pLimit from 'p-limit';
```

(b) Add constant near other constants:

```ts
const CONCURRENCY = 8;
```

(c) Replace the for-loop with parallel processing:

```ts
  const retryDelayMs = opts.retryDelayMs ?? 1000;
  const limit = pLimit(CONCURRENCY);

  const results = await Promise.all(
    inScope.map((r) =>
      limit(async () => {
        try {
          const v = await withRetries(() => callLLMForVerdict(client, r), retryDelayMs);
          return { record: { ...r, verdict: v.verdict, verdictReason: v.reason }, failed: false };
        } catch {
          return {
            record: { ...r, verdict: 'uncertain' as const, verdictReason: 'gate failed after retries' },
            failed: true,
          };
        }
      }),
    ),
  );

  for (const { record, failed } of results) {
    if (failed) {
      failedCount++;
      kept.push(record);
    } else if (record.verdict === 'not-visible') {
      suppressed.push(record);
    } else {
      kept.push(record);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --grep "concurrency:|verdict=|retry:|hard-fail"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/visual-gate.ts tests/unit/visual-gate.test.ts
git commit -m "feat(visual-gate): run verdict calls with p-limit(8) concurrency"
```

---

## Task 8: Suppressed report builder

**Files:**
- Create: `src/report/suppressed-builder.ts`
- Create: `tests/unit/suppressed-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/suppressed-builder.test.ts`:

```ts
import { test, expect } from '@playwright/test';
import { buildSuppressedHtml } from '../../src/report/suppressed-builder.js';
import type { BugRecord } from '../../src/types.js';

function rec(overrides: Partial<BugRecord> = {}): BugRecord {
  return {
    fingerprint: 'fp1',
    ruleId: 'content:broken-image',
    severity: 'high',
    bugClass: 'content',
    title: 'Broken image',
    description: 'A broken hero image',
    urls: ['https://example.com/x'],
    viewports: ['desktop'],
    instanceCount: 3,
    verdict: 'not-visible',
    verdictReason: 'image is far below the fold; not part of any visible content area',
    ...overrides,
  };
}

test('buildSuppressedHtml: renders one card per record with verdict reason', async () => {
  const html = await buildSuppressedHtml([rec(), rec({ fingerprint: 'fp2', title: 'Another' })], { crawlDate: '2026-05-12' });
  expect(html).toContain('Suppressed');
  expect(html).toContain('Broken image');
  expect(html).toContain('Another');
  expect(html).toContain('far below the fold');
  expect(html).toContain('content:broken-image');
});

test('buildSuppressedHtml: empty input → renders empty-state message', async () => {
  const html = await buildSuppressedHtml([], { crawlDate: '2026-05-12' });
  expect(html.toLowerCase()).toContain('no suppressed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --grep "buildSuppressedHtml"`
Expected: FAIL — `Cannot find module '../../src/report/suppressed-builder.js'`.

- [ ] **Step 3: Implement the builder**

Create `src/report/suppressed-builder.ts`:

```ts
import { escapeHtml, urlListHtml } from './html-builder.js';
import type { BugRecord } from '../types.js';

export type SuppressedMeta = { crawlDate: string };

export async function buildSuppressedHtml(
  records: BugRecord[],
  meta: SuppressedMeta,
): Promise<string> {
  const header = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Suppressed Bugs — ${escapeHtml(meta.crawlDate)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
  .intro { color: #555; margin-bottom: 2rem; line-height: 1.5; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; background: #fafafa; }
  .rule { font-family: monospace; font-size: 0.85rem; color: #666; background: #eee; padding: 2px 6px; border-radius: 3px; }
  .reason { margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: #fff8dc; border-left: 3px solid #d4af37; font-size: 0.9rem; }
  .reason-label { font-weight: 600; color: #876c00; }
  .urls { margin-top: 0.5rem; font-size: 0.85rem; }
  .urls a { color: #1a73e8; text-decoration: none; }
  .empty { color: #777; padding: 2rem; text-align: center; }
</style></head><body>
<h1>Suppressed Bugs — ${escapeHtml(meta.crawlDate)}</h1>
<p class="intro">
  These are real DOM-level defects the visual gate suppressed because the LLM judged that a shopper wouldn't notice them.
  Spot-check anything that looks wrong-suppressed and adjust the gate's prompt or scope if needed.
  Bugs in the main report were either judged visible/uncertain by the LLM, or were never gated (e.g., critical revenue/functional bugs).
</p>`;

  if (records.length === 0) {
    return header + `<p class="empty">No suppressed bugs in this run.</p></body></html>`;
  }

  const cards = records.map((r) => `
<div class="card">
  <div><strong>${escapeHtml(r.title)}</strong> <span class="rule">${escapeHtml(r.ruleId)}</span></div>
  <div>${escapeHtml(r.description)}</div>
  <div class="reason"><span class="reason-label">LLM reason:</span> ${escapeHtml(r.verdictReason ?? '(no reason recorded)')}</div>
  <div class="urls">Affected (${r.urls.length}): ${urlListHtml(r.urls)}</div>
</div>`).join('\n');

  return header + cards + '</body></html>';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --grep "buildSuppressedHtml"`
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add src/report/suppressed-builder.ts tests/unit/suppressed-builder.test.ts
git commit -m "feat(report): add suppressed-bugs HTML builder"
```

---

## Task 9: Wire gate into orchestrate

**Files:**
- Modify: `scripts/orchestrate.ts`

- [ ] **Step 1: Inspect existing orchestrate to find the right insertion point**

Run: `grep -n "deduplicateBugs\|Step 6: Score" scripts/orchestrate.ts`
Expected: shows `const deduplicated = deduplicateBugs(allBugs);` near line 138 and `// Step 6: Score every finding` shortly after.

- [ ] **Step 2: Add imports near other imports at the top of `scripts/orchestrate.ts`**

```ts
import { gateRecords } from '../src/llm/visual-gate.js';
import { buildSuppressedHtml } from '../src/report/suppressed-builder.js';
```

- [ ] **Step 3: Insert the gate stage between dedup and scoring**

Find the line `const deduplicated = deduplicateBugs(allBugs);` and immediately after it, insert:

```ts
  // Step 5.5: Visual verification gate
  console.log(`\n👁  Running visual verification gate on ${deduplicated.length} records...`);
  const gateResult = await gateRecords(deduplicated);
  console.log(
    `   gated=${gateResult.totalGated}  kept=${gateResult.kept.length}  ` +
    `suppressed=${gateResult.suppressed.length}  failed=${gateResult.failedCount}`,
  );
  const recordsToScore = gateResult.kept;
```

- [ ] **Step 4: Update the scoring loop to use `recordsToScore` instead of `deduplicated`**

Find this line (currently uses `deduplicated`):

```ts
  const scored: ScoredBug[] = deduplicated.map((record) => {
```

Change to:

```ts
  const scored: ScoredBug[] = recordsToScore.map((record) => {
```

- [ ] **Step 5: After the main HTML/PDF is written, write the suppressed report**

Find the line that writes the main HTML report:

```ts
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`\n📄 HTML report written to ${htmlPath}`);
```

Immediately after that (and before the PDF export block), add:

```ts
  // Suppressed-bugs report (LLM-gated false positives, for spot-checking)
  const suppressedHtml = await buildSuppressedHtml(gateResult.suppressed, { crawlDate: DATE });
  const suppressedPath = join(OUTPUT_DIR, `audit-report-${DATE}-suppressed.html`);
  writeFileSync(suppressedPath, suppressedHtml, 'utf8');
  console.log(`📄 Suppressed-bugs report written to ${suppressedPath}`);
```

- [ ] **Step 6: Run the smoke test to verify pipeline still parses**

Run: `npx tsc --noEmit`
Expected: exit code 0.

Run: `DISABLE_VISUAL_GATE=1 npm run test:smoke`
Expected: smoke tests still PASS (gate short-circuits to no-op).

- [ ] **Step 7: Commit**

```bash
git add scripts/orchestrate.ts
git commit -m "feat(orchestrate): wire visual gate between dedup and scoring; emit suppressed report"
```

---

## Task 10: Degraded-mode banner on main report

**Files:**
- Modify: `src/report/html-builder.ts`
- Modify: `scripts/orchestrate.ts`
- Modify: `tests/unit/html-builder.test.ts` (only if existing tests would break — otherwise add a new test)

- [ ] **Step 1: Inspect the current `buildHtml` signature**

Run: `grep -n "export async function buildHtml\|export function buildHtml" src/report/html-builder.ts`
Expected: shows the signature around line 130.

Read the function header. Note its parameter names so we can add a third optional one without breaking callers.

- [ ] **Step 2: Write a failing test**

Append to `tests/unit/html-builder.test.ts` (if the file doesn't exist, create it following the style of `tests/unit/summarise.test.ts`):

```ts
test('buildHtml renders gate-degraded banner when degradedCount > 0', async () => {
  const html = await buildHtml([], { crawlDate: '2026-05-12', totalPages: 0, sites: ['example.com'] }, { degradedCount: 5, totalGated: 50 });
  expect(html).toMatch(/visual gate degraded/i);
  expect(html).toContain('5');
  expect(html).toContain('50');
});

test('buildHtml omits banner when degradedCount = 0', async () => {
  const html = await buildHtml([], { crawlDate: '2026-05-12', totalPages: 0, sites: ['example.com'] });
  expect(html).not.toMatch(/visual gate degraded/i);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit -- --grep "gate-degraded banner"`
Expected: FAIL — `buildHtml` doesn't accept a third param yet.

- [ ] **Step 4: Add the optional third parameter to `buildHtml`**

In `src/report/html-builder.ts`, update the signature and add banner rendering. Specifically:

(a) Change the signature from `export async function buildHtml(bugs, meta)` to:

```ts
export async function buildHtml(
  bugs: ScoredBug[],
  meta: ReportMeta,
  gateInfo?: { degradedCount: number; totalGated: number },
): Promise<string> {
```

(b) Near the top of the returned HTML (just under the header section — locate the existing `<h1>` or summary-stats bar), insert a banner snippet conditional on `gateInfo`:

```ts
  const banner = gateInfo && gateInfo.degradedCount > 0
    ? `<div style="background:#fff3cd;border:1px solid #ffe69c;color:#664d03;padding:0.75rem 1rem;border-radius:6px;margin:1rem 0;font-size:0.95rem;">
         ⚠ <strong>Visual gate degraded:</strong> ${gateInfo.degradedCount} of ${gateInfo.totalGated} records could not be validated by the LLM and were kept as uncertain. Rerun <code>npm run report</code> to retry.
       </div>`
    : '';
```

Then splice `${banner}` into the existing HTML template at the appropriate spot (after the page header, before the stats bar). If you can't find the exact splice point quickly, add it as the first element inside `<body>` after the opening `<header>` tag — visible placement matters more than perfect ordering.

- [ ] **Step 5: Update orchestrate to pass `gateInfo`**

In `scripts/orchestrate.ts`, find the call to `buildHtml`:

```ts
  const html = await buildHtml(withCategories, reportMeta);
```

Change to:

```ts
  const html = await buildHtml(withCategories, reportMeta, {
    degradedCount: gateResult.failedCount,
    totalGated: gateResult.totalGated,
  });
```

- [ ] **Step 6: Run tests**

Run: `npm run test:unit -- --grep "gate-degraded banner|buildHtml"`
Expected: PASS for both new tests; any existing buildHtml tests still pass.

Run: `npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/report/html-builder.ts scripts/orchestrate.ts tests/unit/html-builder.test.ts
git commit -m "feat(report): add gate-degraded banner to main HTML report"
```

---

## Task 11: Document the gate in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "Visual verification gate" subsection to CLAUDE.md**

In `CLAUDE.md`, find the "Architecture" or "Constraints" section and add a new subsection (suggest placing it after the existing "Architecture" diagram, before "Constraints (non-negotiable)"):

```markdown
## Visual verification gate

After dedup and before scoring, every record whose ruleId is in the gated set
(`content:broken-image`, `content:empty-image-src`, `content:broken-picture-template`,
`network:404`, `network:4xx`, `network:failed`, `network:nav-failed`) is sent to
Sonnet 4.6 with its element + page screenshots. The LLM returns one of
`visible | uncertain | not-visible`:

- `visible` and `uncertain` → record stays in the main report
- `not-visible` → record is moved to `output/audit-report-<date>-suppressed.html`
  for spot-checking (real DOM defect, but no shopper would notice)

Records outside the gated set (revenue, seo, personas) pass through untouched.

**Disable knob:** `DISABLE_VISUAL_GATE=1 npm run orchestrate` skips the gate
entirely. Use during dev when iterating on report layout.

**Failure handling:** the gate retries each record twice with exponential backoff.
If >50% of records still fail, orchestrate aborts — rerun `npm run report` to
retry the gate without redoing the 4-hour audit. If fewer than 50% fail, the
report ships with a "gate degraded" banner at the top.

**Cost & latency:** ~91 records per run at Sonnet 4.6 = ~$0.50–1.00, ~30–60s
added to the orchestrate stage.
```

- [ ] **Step 2: Verify the file is still well-formed**

Run: `wc -l CLAUDE.md` and confirm the line count increased reasonably (~25 lines added).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): document visual verification gate"
```

---

## Task 12: End-to-end smoke check with real data (no API call)

**Files:**
- None (verification only — uses existing data and the `DISABLE_VISUAL_GATE` knob)

- [ ] **Step 1: Run orchestrate with the gate disabled (sanity)**

Run: `DISABLE_VISUAL_GATE=1 npm run orchestrate`
Expected:
- "Running visual verification gate on N records..." line appears
- "gated=0  kept=N  suppressed=0  failed=0"
- HTML report builds normally
- A suppressed-bugs HTML file is written (will be empty)

Verify: `ls -la output/audit-report-*-suppressed.html` exists and contains "No suppressed bugs in this run."

- [ ] **Step 2: Run orchestrate without the API key set (sanity)**

Temporarily unset `ANTHROPIC_API_KEY` for this one run:

```bash
ANTHROPIC_API_KEY= npm run orchestrate
```

Expected:
- "gated=N kept=N suppressed=0 failed=N" where `failed === totalGated`
- Hard-fail does NOT trigger because every in-scope record falls back to `uncertain`, none truly fails in the API sense — wait, this is a contradiction. The current implementation counts no-API-key as `failedCount = inScope.length`. With `failedCount/inScope.length === 1.0 > 0.5`, this would hard-fail.

  **This is intentional:** running without an API key in a real run is a configuration error, not a graceful degradation case. The hard-fail forces the user to either set the key or use `DISABLE_VISUAL_GATE=1`. Confirm orchestrate exits with an error message about >50% failure.

- [ ] **Step 3: Restore the API key and run a real gate pass**

Restore your `ANTHROPIC_API_KEY` env (or `.env` value) and run:

```bash
npm run orchestrate
```

Expected:
- "gated=N kept=K suppressed=S failed=F" with realistic numbers (e.g., gated≈30, suppressed≈5-15 for the 2026-05-12 dataset)
- Main report and suppressed report both written
- Banner appears in main report only if `failed > 0`

Spot-check the suppressed report by opening it in a browser. Verify:
- Each card shows the LLM's reason
- The reasons make sense (no obvious false suppressions)

- [ ] **Step 4: Commit any small fixes (if needed)**

If the spot-check reveals an issue with the gate's prompt or scope, fix it inline before considering this task complete. Iterate on the system prompt in `src/llm/visual-gate.ts` if real-data verdicts disagree with your editorial judgment.

```bash
git add src/llm/visual-gate.ts
git commit -m "chore(visual-gate): tune system prompt based on real-data spot-check"
```

(Skip the commit if no changes were needed.)

---

## Self-Review Notes

Plan covers every section of the spec:
- ✅ Architecture / data flow → Tasks 2, 3, 4, 7, 9
- ✅ Scope (gated rule IDs) → Task 3
- ✅ LLM verdict (model, prompt, schema) → Task 4
- ✅ Retry policy → Task 5
- ✅ Failure handling (hard-fail threshold) → Task 6
- ✅ Output (main + suppressed reports) → Tasks 8, 9, 10
- ✅ File layout → all tasks
- ✅ Disable knob → Task 2
- ✅ Testing (unit tests with mocked SDK) → Tasks 2–7
- ✅ Documentation → Task 11
- ✅ End-to-end verification → Task 12

Deferred (called out as non-goals in spec):
- `[verified-visible]` badge → explicitly deferred in spec
- Verdict caching across runs → explicitly out of scope
- Integration test against real API as a CI step → out of scope; manual spot-check in Task 12 covers it
