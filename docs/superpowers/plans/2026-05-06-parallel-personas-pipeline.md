# Parallel Personas + Pipeline Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run agentic personas in parallel with Playwright, add per-persona model selection, remove reverify, and add LLM semantic dedup for persona findings.

**Architecture:** A new `scripts/run-audit.ts` launcher spawns Playwright and `discover-agentic` as child processes simultaneously; `orchestrate.ts` then runs validate alone (personas already done), calls semantic dedup on discoveries, scores, and builds the report. Reverify is removed entirely.

**Tech Stack:** TypeScript, `node:child_process`, Anthropic SDK (`claude-sonnet-4-6` / `claude-haiku-4-5-20251001`), Playwright

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Create | `scripts/run-audit.ts` | Parallel launcher for Playwright + discover-agentic |
| Create | `scripts/semantic-dedup.ts` | LLM dedup pass for discovery findings |
| Modify | `src/discovery/agent-loop.ts` | Add `model` param to `SessionOptions` and message create |
| Modify | `src/discovery/persona-runner.ts` | Add `PERSONA_MODEL` map, pass model to `runSession` |
| Modify | `scripts/orchestrate.ts` | Remove reverify steps, remove discover-agentic from parallel, add semantic dedup call |
| Modify | `package.json` | Update `full-audit` to use `run-audit.ts` |

---

## Task 1: Add `model` param to agent-loop.ts

**Files:**
- Modify: `src/discovery/agent-loop.ts`

The `runSession` function hardcodes `model: 'claude-sonnet-4-6'` inside the `client.messages.create` call. Add a `model` field to `SessionOptions` with a default so callers that don't pass it continue working.

- [ ] **Step 1: Edit `src/discovery/agent-loop.ts`**

Find the `SessionOptions` interface (lines 8–18) and add `model?: string`:

```ts
export interface SessionOptions {
  client: Anthropic;
  page: Page;
  personaSystemPrompt: string;
  personaName: string;
  targetUrls: string[];
  previousFindingsSummary: string;
  screenshotsDir: string;
  discoveriesPath: string;
  sessionBudget?: number;
  model?: string;
}
```

Then find the `client.messages.create` call (line ~64) and change the `model` field:

```ts
    const response = await client.messages.create({
      model: model ?? 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: personaSystemPrompt,
      tools: tools.definitions,
      messages,
    });
```

Also destructure `model` from `opts` at the top of `runSession`:

```ts
  const {
    client, page, personaSystemPrompt, personaName,
    targetUrls, previousFindingsSummary, screenshotsDir,
    discoveriesPath, sessionBudget = 20, model,
  } = opts;
```

- [ ] **Step 2: Verify**

```bash
grep -n 'model' "/Users/ryzeuser/Claude Code/QA Agent/src/discovery/agent-loop.ts"
```

Expected: `model?: string` in the interface, `model ?? 'claude-sonnet-4-6'` in the create call, and `model` in the destructure.

- [ ] **Step 3: Commit**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent"
git add src/discovery/agent-loop.ts
git commit -m "feat: add model param to agent-loop SessionOptions"
```

---

## Task 2: Add per-persona model selection to persona-runner.ts

**Files:**
- Modify: `src/discovery/persona-runner.ts`

Add a `PERSONA_MODEL` map and pass the right model to `runSession`. Sonnet for qualitative judgment personas, Haiku for structured verification personas.

- [ ] **Step 1: Edit `src/discovery/persona-runner.ts`**

Add the model map after the existing `PERSONA_VIEWPORT` map (around line 24):

```ts
const PERSONA_MODEL: Record<string, string> = {
  'revenue-hawk':          'claude-haiku-4-5-20251001',
  'skeptical-first-timer': 'claude-sonnet-4-6',
  'brand-purist':          'claude-sonnet-4-6',
  'forensic-technician':   'claude-haiku-4-5-20251001',
};
```

Then in `runPersona`, find the `runSession` call and add `model`:

```ts
      const result = await runSession({
        client,
        page,
        personaSystemPrompt: systemPrompt,
        personaName,
        targetUrls: unvisited,
        previousFindingsSummary: summary,
        screenshotsDir,
        discoveriesPath,
        sessionBudget: SESSION_BUDGET,
        model: PERSONA_MODEL[personaName] ?? 'claude-sonnet-4-6',
      });
```

- [ ] **Step 2: Verify**

```bash
grep -n 'PERSONA_MODEL\|haiku\|model' "/Users/ryzeuser/Claude Code/QA Agent/src/discovery/persona-runner.ts"
```

Expected: `PERSONA_MODEL` map visible with haiku entries for revenue-hawk and forensic-technician.

- [ ] **Step 3: Commit**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent"
git add src/discovery/persona-runner.ts
git commit -m "feat: per-persona model selection (Haiku for structured, Sonnet for qualitative)"
```

---

## Task 3: Create semantic-dedup.ts

**Files:**
- Create: `scripts/semantic-dedup.ts`

Single Haiku batch call that takes discovery findings, identifies semantic duplicates, and returns a deduplicated array. Soft failure — if the LLM call fails for any reason, returns input unchanged.

- [ ] **Step 1: Create `scripts/semantic-dedup.ts`**

```ts
// scripts/semantic-dedup.ts
import Anthropic from '@anthropic-ai/sdk';
import type { DiscoveryFinding } from '../src/types.js';

const MODEL = 'claude-haiku-4-5-20251001';

export async function semanticDedup(
  client: Anthropic,
  findings: DiscoveryFinding[],
): Promise<DiscoveryFinding[]> {
  if (findings.length <= 1) return findings;

  const numbered = findings
    .map((f, i) => `[${i}] ${f.ruleId} @ ${f.url}\n    ${f.claim}`)
    .join('\n');

  let raw: string;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        'You are a deduplication assistant. Identify groups of bug reports that describe the same underlying defect on the same or similar pages. Different phrasings of the same broken element = same bug. Different elements or different pages = different bugs. Respond ONLY with a JSON array. Each element is an object with "keep" (index of the best report to keep) and "discard" (array of indices to remove). If no duplicates exist, respond with [].',
      messages: [
        {
          role: 'user',
          content: `These are persona-discovered bug reports. Identify duplicates:\n\n${numbered}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    raw = textBlock?.type === 'text' ? textBlock.text.trim() : '[]';
  } catch (err) {
    console.warn('⚠️  Semantic dedup LLM call failed — skipping dedup:', (err as Error).message);
    return findings;
  }

  let groups: Array<{ keep: number; discard: number[] }>;
  try {
    // Strip markdown code fences if model wraps response
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    groups = JSON.parse(jsonStr);
  } catch {
    console.warn('⚠️  Semantic dedup response parse failed — skipping dedup. Raw:', raw.slice(0, 200));
    return findings;
  }

  const discardSet = new Set<number>();
  for (const group of groups) {
    for (const idx of group.discard) {
      if (idx >= 0 && idx < findings.length) discardSet.add(idx);
    }
  }

  const result = findings.filter((_, i) => !discardSet.has(i));
  if (discardSet.size > 0) {
    console.log(`  🔁 Semantic dedup: removed ${discardSet.size} duplicate persona finding(s), ${result.length} remain`);
  }
  return result;
}
```

- [ ] **Step 2: Verify the file exists and TypeScript is happy**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors referencing `semantic-dedup.ts`. (Ignore unrelated pre-existing errors if any.)

- [ ] **Step 3: Commit**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent"
git add scripts/semantic-dedup.ts
git commit -m "feat: add LLM semantic dedup for persona discovery findings"
```

---

## Task 4: Update orchestrate.ts — remove reverify, add semantic dedup

**Files:**
- Modify: `scripts/orchestrate.ts`

Three changes:
1. Change `Promise.all([runScript('validate'), runScript('discover-agentic')])` → just `runScript('validate')` (personas already ran)
2. Add `semanticDedup` call after discoveries are loaded
3. Remove Step 7 (reverify) and Step 8 (read back)

- [ ] **Step 1: Add import for semanticDedup**

At the top of `scripts/orchestrate.ts`, add after the existing imports:

```ts
import { semanticDedup } from './semantic-dedup.js';
```

- [ ] **Step 2: Change Step 1 — validate only**

Find line ~72:
```ts
  // Step 1: Run validation and discovery in parallel
  await Promise.all([runScript('validate'), runScript('discover-agentic')]);
```

Replace with:
```ts
  // Step 1: Run validation (personas already ran in parallel with Playwright)
  await runScript('validate');
```

- [ ] **Step 3: Add semantic dedup after discoveries are loaded**

Find the existing Step 3 comment around line 97:
```ts
  // Step 3: Load and validate discovery findings
  const discoveries: DiscoveryFinding[] = existsSync(DISCOVERIES_PATH)
    ? readFileSync(DISCOVERIES_PATH, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as DiscoveryFinding)
        .filter((f) => enforceEvidence(f).valid)
    : [];
```

Replace with:
```ts
  // Step 3: Load and validate discovery findings, then semantic dedup
  const rawDiscoveries: DiscoveryFinding[] = existsSync(DISCOVERIES_PATH)
    ? readFileSync(DISCOVERIES_PATH, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as DiscoveryFinding)
        .filter((f) => enforceEvidence(f).valid)
    : [];

  const discoveries = client && rawDiscoveries.length > 1
    ? await semanticDedup(client, rawDiscoveries)
    : rawDiscoveries;
```

- [ ] **Step 4: Remove reverify steps**

Find and remove Steps 7 and 8 entirely (lines ~185–189):
```ts
  // Step 7: Re-verify top 10
  await runScript('reverify');

  // Step 8: Read back (reverify mutates scored-bugs.json)
  const finalScored: ScoredBug[] = JSON.parse(readFileSync(SCORED_PATH, 'utf8'));
```

Replace with:
```ts
  const finalScored = scored;
```

- [ ] **Step 5: Verify**

```bash
grep -n 'reverify\|discover-agentic\|semanticDedup\|rawDiscoveries' "/Users/ryzeuser/Claude Code/QA Agent/scripts/orchestrate.ts"
```

Expected:
- `reverify` — NOT present
- `discover-agentic` — NOT present  
- `semanticDedup` — present (import + call)
- `rawDiscoveries` — present

- [ ] **Step 6: TypeScript check**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent"
git add scripts/orchestrate.ts
git commit -m "feat: remove reverify, run validate-only in orchestrate, add semantic dedup"
```

---

## Task 5: Create scripts/run-audit.ts — parallel launcher

**Files:**
- Create: `scripts/run-audit.ts`

Spawns `npm run test:audit` and `npm run discover:agentic` as child processes simultaneously. Labels output from each. Waits for both. Exits non-zero if either fails.

- [ ] **Step 1: Create `scripts/run-audit.ts`**

```ts
// scripts/run-audit.ts
import 'dotenv/config';
import { spawn } from 'node:child_process';

function spawnNpm(script: string, label: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'pipe',
      shell: false,
    });

    child.stdout.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) process.stdout.write(`[${label}] ${line}\n`);
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) process.stderr.write(`[${label}] ${line}\n`);
      }
    });

    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  console.log('\n▶ Starting Playwright audit and agentic personas in parallel...\n');

  const [playwrightCode, personaCode] = await Promise.all([
    spawnNpm('test:audit', 'playwright'),
    spawnNpm('discover:agentic', 'persona'),
  ]);

  if (playwrightCode !== 0) {
    console.error(`\n❌ Playwright audit exited with code ${playwrightCode}`);
    process.exit(playwrightCode);
  }

  if (personaCode !== 0) {
    console.warn(`\n⚠️  Agentic personas exited with code ${personaCode} — continuing with partial discoveries`);
    // Non-fatal: discoveries.jsonl may be partial but Playwright bugs are complete
  }

  console.log('\n✅ Audit phase complete (Playwright + personas)\n');
}

main().catch((err) => {
  console.error('run-audit failed:', err);
  process.exit(1);
});
```

Note: persona failures are non-fatal — Playwright bugs are the primary dataset. Persona failures log a warning but don't abort the pipeline.

- [ ] **Step 2: Verify it compiles**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors from `run-audit.ts`.

- [ ] **Step 3: Smoke test (dry run)**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npx tsx scripts/run-audit.ts --help 2>&1 | head -5
```

Expected: script starts (no import errors). It will immediately try to spawn npm processes — Ctrl+C after 2s is fine; we're just checking imports resolve.

- [ ] **Step 4: Commit**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent"
git add scripts/run-audit.ts
git commit -m "feat: parallel audit launcher — Playwright + personas run concurrently"
```

---

## Task 6: Update package.json full-audit script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Edit package.json**

Find the current `full-audit` line:
```json
"full-audit": "npm run clean && npm run test:crawl && npm run orchestrate",
```

Wait — the current `full-audit` script (after our earlier change today) is:
```json
"full-audit": "npm run clean && npm run test:crawl && npm run test:audit && npm run orchestrate",
```

Replace with:
```json
"full-audit": "npm run clean && npm run test:crawl && npx tsx scripts/run-audit.ts && npm run orchestrate",
```

The `run-audit.ts` step replaces `npm run test:audit` — it now runs both Playwright and personas in parallel.

- [ ] **Step 2: Verify**

```bash
grep 'full-audit\|audit-only' "/Users/ryzeuser/Claude Code/QA Agent/package.json"
```

Expected:
- `full-audit` contains `run-audit.ts`
- `audit-only` still exists as the no-LLM fallback

- [ ] **Step 3: Commit**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent"
git add package.json
git commit -m "feat: full-audit now runs Playwright + personas in parallel via run-audit.ts"
```

---

## Task 7: End-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Confirm TypeScript compiles cleanly**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npx tsc --noEmit 2>&1
```

Expected: no errors. (Note: pre-existing errors from unrelated files are acceptable if they existed before this work.)

- [ ] **Step 2: Verify orchestrate no longer references reverify or discover-agentic**

```bash
grep -n 'reverify\|discover-agentic' "/Users/ryzeuser/Claude Code/QA Agent/scripts/orchestrate.ts"
```

Expected: no output.

- [ ] **Step 3: Verify model map is in persona-runner**

```bash
grep -A 6 'PERSONA_MODEL' "/Users/ryzeuser/Claude Code/QA Agent/src/discovery/persona-runner.ts"
```

Expected: 4-entry map with haiku for revenue-hawk and forensic-technician.

- [ ] **Step 4: Verify full-audit script chain**

```bash
grep 'full-audit' "/Users/ryzeuser/Claude Code/QA Agent/package.json"
```

Expected: `run-audit.ts` in the command.

- [ ] **Step 5: Start the full audit**

```bash
cd "/Users/ryzeuser/Claude Code/QA Agent" && npm run full-audit > output/audit-run.log 2>&1 &
echo "PID: $! — tailing output/audit-run.log"
tail -f output/audit-run.log | grep --line-buffered -E '\[playwright\]|\[persona\]|✅|⚠️|❌|complete|report|Error'
```

Expected first ~30 seconds of output:
```
[playwright] Running 4 tests using 2 workers
[persona] 🔍 Agentic discovery: 245 URLs across 4 personas (2 concurrent)
[persona] ▶ Batch: revenue-hawk + skeptical-first-timer
[playwright] [1/4] › @audit — run full audit across all URLs
```

If you see both `[playwright]` and `[persona]` lines interleaved, parallelism is working.

---

## Self-Review

**Spec coverage:**
- ✅ Personas run in parallel with Playwright — Task 5 + Task 6
- ✅ Per-persona model split — Task 1 + Task 2
- ✅ Reverify removed — Task 4
- ✅ Semantic dedup for persona findings — Task 3 + Task 4
- ✅ `full-audit` wired correctly — Task 6
- ✅ Validate runs alone in orchestrate — Task 4

**Placeholder scan:** No TBD or TODO entries. All code blocks complete.

**Type consistency:**
- `semanticDedup(client: Anthropic, findings: DiscoveryFinding[]): Promise<DiscoveryFinding[]>` defined in Task 3, called correctly in Task 4
- `model?: string` added to `SessionOptions` in Task 1, passed in Task 2
- `rawDiscoveries` / `discoveries` naming consistent in Task 4
- `finalScored = scored` (direct assignment, no type change) in Task 4
