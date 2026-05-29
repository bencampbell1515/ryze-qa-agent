import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { runGateBatch } from '../../src/gate/batch.js';
import type { Finding, ElementCrop } from '../../src/types/finding.js';

const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';

let tmpRoot: string;
let cropSeq = 0;

test.beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ryze-gate-2j-'));
  cropSeq = 0;
});
test.afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function realCrop(): ElementCrop {
  const path = join(tmpRoot, `crop-${cropSeq++}.png`);
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return { path, width: 10, height: 10, padding: 16, boundingBoxDrawn: true };
}

function makeFinding(urlKey: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id: `f-${urlKey}`,
    fingerprint: `fp-${urlKey}`,
    runId: 'run-1',
    discoveredAt: '2026-05-29T00:00:00.000Z',
    ruleId: 'content:broken-image',
    category: 'content',
    source: 'deterministic',
    severity: 'high',
    url: `https://www.ryzesuperfoods.com${urlKey}`,
    title: 'Broken image',
    description: 'Image failed to load.',
    confidence: 0.9,
    crop: realCrop(),
    ...overrides,
  };
}

/**
 * Client that dispatches by (finding URL marker, model). The single-judge pass
 * (J) calls with the default model (SONNET); the two-judge passes call with each
 * of the configured models. Verdicts are keyed by URL substring so each finding
 * can drive a different routing outcome.
 */
function scenarioClient(plan: Record<string, Record<string, unknown>>): {
  client: Anthropic;
  calls: () => number;
} {
  let n = 0;
  const client = {
    messages: {
      create: async ({ model, messages }: { model: string; messages: any[] }) => {
        n++;
        const text: string = messages[0].content[0].text;
        const key = Object.keys(plan).find((k) => text.includes(k));
        if (!key) throw new Error(`no plan matched for content: ${text.slice(0, 80)}`);
        const input = plan[key]![model];
        if (input === undefined) throw new Error(`no plan for ${key} model ${model}`);
        return { content: [{ type: 'tool_use', name: 'submit_verdict', id: 'toolu', input }] };
      },
    },
  } as unknown as Anthropic;
  return { client, calls: () => n };
}

const baseConfig = (client: Anthropic, extra = {}) => ({
  client,
  retryDelayMs: 1,
  suppressedPath: join(tmpRoot, 'suppressed.jsonl'),
  uncertainPath: join(tmpRoot, 'uncertain.jsonl'),
  ...extra,
});

test('enableTwoJudge=true with mixed J-uncertain verdicts → three tiers, correct counts', async () => {
  const { client } = scenarioClient({
    '/to-main': { [SONNET]: { verdict: 'uncertain', confidence: 0.3 }, [OPUS]: { verdict: 'confirmed', confidence: 0.9 } },
    '/to-unc': { [SONNET]: { verdict: 'uncertain', confidence: 0.3 }, [OPUS]: { verdict: 'uncertain', confidence: 0.4 } },
    '/to-sup': { [SONNET]: { verdict: 'uncertain', confidence: 0.3 }, [OPUS]: { verdict: 'refuted', confidence: 0.95 } },
  });
  const findings = [makeFinding('/to-main'), makeFinding('/to-unc'), makeFinding('/to-sup')];

  const { kept, uncertain, suppressed } = await runGateBatch(
    findings,
    baseConfig(client, { enableTwoJudge: true }),
  );

  expect(kept).toHaveLength(1);
  expect(kept[0]!.url).toContain('/to-main');
  expect(kept[0]!.visualGate!.verdict).toBe('visible');
  expect(kept[0]!.visualGate!.judgeModel).toBe(`${SONNET}+${OPUS}`);

  expect(uncertain).toHaveLength(1);
  expect(uncertain[0]!.url).toContain('/to-unc');
  expect(uncertain[0]!.visualGate!.verdict).toBe('uncertain');

  expect(suppressed).toHaveLength(1);
  expect(suppressed[0]!.url).toContain('/to-sup');
});

test('enableTwoJudge=false → identical to J: J-uncertain finding stays in kept, no uncertain tier', async () => {
  const { client, calls } = scenarioClient({
    '/stay': { [SONNET]: { verdict: 'uncertain', confidence: 0.3 } },
  });
  const findings = [makeFinding('/stay')];

  const { kept, uncertain, suppressed } = await runGateBatch(
    findings,
    baseConfig(client, { enableTwoJudge: false }),
  );

  expect(kept).toHaveLength(1);
  expect(kept[0]!.visualGate!.verdict).toBe('uncertain');
  expect(uncertain).toHaveLength(0);
  expect(suppressed).toHaveLength(0);
  expect(calls()).toBe(1); // single judge only — no second pass
});

test('uncertain-findings.jsonl is written (parseable) when uncertain tier has entries', async () => {
  const { client } = scenarioClient({
    '/to-unc': { [SONNET]: { verdict: 'uncertain', confidence: 0.3 }, [OPUS]: { verdict: 'uncertain', confidence: 0.4 } },
  });
  const uncertainPath = join(tmpRoot, 'uncertain.jsonl');
  await runGateBatch([makeFinding('/to-unc')], baseConfig(client, { enableTwoJudge: true, uncertainPath }));

  expect(existsSync(uncertainPath)).toBe(true);
  const lines = readFileSync(uncertainPath, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0]!) as Finding;
  expect(parsed.url).toContain('/to-unc');
  expect(parsed.visualGate!.verdict).toBe('uncertain');
});

test('no uncertain entries → uncertainPath file is not created', async () => {
  const { client } = scenarioClient({
    '/to-main': { [SONNET]: { verdict: 'uncertain', confidence: 0.3 }, [OPUS]: { verdict: 'confirmed', confidence: 0.9 } },
  });
  const uncertainPath = join(tmpRoot, 'uncertain.jsonl');
  await runGateBatch([makeFinding('/to-main')], baseConfig(client, { enableTwoJudge: true, uncertainPath }));
  expect(existsSync(uncertainPath)).toBe(false);
});

test('two-judge only escalates J-uncertain findings; a confident J-confirmed skips the second pass', async () => {
  const { client, calls } = scenarioClient({
    '/confident': { [SONNET]: { verdict: 'confirmed', confidence: 0.95 } },
  });
  const { kept, uncertain } = await runGateBatch(
    [makeFinding('/confident')],
    baseConfig(client, { enableTwoJudge: true }),
  );
  expect(kept).toHaveLength(1);
  expect(uncertain).toHaveLength(0);
  expect(calls()).toBe(1); // J confirmed → no two-judge escalation
});
