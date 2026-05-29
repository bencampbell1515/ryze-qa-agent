import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, RubricVerdict, Verdict } from '../types/finding.js';
import { captureCrop } from '../crops/index.js';
import { ElementNotVisibleError } from '../crops/errors.js';
import { buildFinding } from '../findings/index.js';
import { withRetries } from '../llm/retry.js';
import type { Rubric, RubricInput, RubricResult } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const DEFAULT_RETRY_DELAY_MS = 1000;

const SYSTEM_PROMPT = `You are evaluating a single rendered UI element against a rubric. You are given the element's cropped screenshot, the rubric context, and a numbered list of dimensions, each with explicit pass and fail criteria.

Return one verdict per dimension via the submit_verdicts tool. Be strict about pass/fail: a dimension only "fail"s when its fail criteria are met. Use "pass" when the pass criteria are met, and "uncertain" only when the crop genuinely does not let you decide. When a dimension fails, give a one-line discrepancy describing exactly what is wrong.`;

const TOOL_SCHEMA = {
  name: 'submit_verdicts',
  description: 'Submit one verdict per rubric dimension.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdicts: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            dimension: { type: 'string' as const, description: 'The dimension id this verdict is for' },
            verdict: { type: 'string' as const, enum: ['pass', 'fail', 'uncertain'] },
            confidence: { type: 'number' as const, description: '0.0 to 1.0' },
            discrepancy: { type: 'string' as const, description: 'One-line description of the problem; required when verdict is "fail"' },
          },
          required: ['dimension', 'verdict', 'confidence'],
        },
      },
    },
    required: ['verdicts'],
  },
};

const VALID_VERDICTS: ReadonlySet<string> = new Set(['pass', 'fail', 'uncertain']);

/**
 * Parse the model's tool input into typed RubricVerdicts. Throws (with the raw
 * output in the message) on any contract violation — a missing tool_use block,
 * a non-array verdicts field, an unknown verdict enum, or a non-numeric
 * confidence. Parse errors are NOT retried: they signal the model returned
 * something we can't trust, and the raw output is surfaced for debugging.
 */
function parseVerdicts(raw: unknown, rubricId: string, judgeModel: string): RubricVerdict[] {
  const rawText = JSON.stringify(raw);
  const verdicts = (raw as { verdicts?: unknown })?.verdicts;
  if (!Array.isArray(verdicts)) {
    throw new Error(`Rubric verdict parse failed (no verdicts array): ${rawText}`);
  }
  return verdicts.map((v) => {
    const verdict = (v as { verdict?: unknown }).verdict;
    const confidence = (v as { confidence?: unknown }).confidence;
    const dimension = (v as { dimension?: unknown }).dimension;
    if (typeof verdict !== 'string' || !VALID_VERDICTS.has(verdict)) {
      throw new Error(`Rubric verdict parse failed (invalid verdict): ${rawText}`);
    }
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
      throw new Error(`Rubric verdict parse failed (invalid confidence): ${rawText}`);
    }
    const discrepancy = (v as { discrepancy?: unknown }).discrepancy;
    return {
      rubricId,
      dimension: typeof dimension === 'string' ? dimension : '',
      verdict: verdict as Verdict,
      confidence,
      ...(typeof discrepancy === 'string' && discrepancy ? { discrepancy } : {}),
      judgeModel,
    };
  });
}

function buildUserContent(
  rubric: Rubric,
  input: RubricInput,
  cropBase64: string,
): Anthropic.MessageParam['content'] {
  const dimensionLines = rubric.dimensions
    .map((d, i) => {
      const parts = [`${i + 1}. ${d.id}: ${d.description}`];
      if (d.passCriteria) parts.push(`   Pass: ${d.passCriteria}`);
      if (d.failCriteria) parts.push(`   Fail: ${d.failCriteria}`);
      return parts.join('\n');
    })
    .join('\n');

  const text = [
    `CONTEXT: ${rubric.context}`,
    '',
    `PAGE CONTEXT:\n${JSON.stringify(input.pageContext ?? {}, null, 2)}`,
    '',
    `RUBRIC DIMENSIONS:\n${dimensionLines}`,
    '',
    'The cropped element screenshot is attached. Return one verdict per dimension.',
  ].join('\n');

  return [
    { type: 'text', text },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: cropBase64 } },
  ];
}

async function callLLM(
  client: Anthropic,
  rubric: Rubric,
  input: RubricInput,
  cropBase64: string,
  model: string,
): Promise<unknown> {
  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'submit_verdicts' },
    messages: [{ role: 'user', content: buildUserContent(rubric, input, cropBase64) }],
  });
  const block = response.content.find((b) => b.type === 'tool_use') as
    | Anthropic.ToolUseBlock
    | undefined;
  if (!block) {
    throw new Error(`Rubric verdict parse failed (no tool_use block): ${JSON.stringify(response.content)}`);
  }
  return block.input;
}

/**
 * Evaluate an element against a rubric. Captures a tight crop, sends the crop +
 * rubric to Claude (forced tool use), parses one RubricVerdict per dimension,
 * and emits a Finding when any dimension fails.
 *
 * Outcomes:
 * - Invisible/zero-area element → { finding: null, verdicts: [], cropPath: '' };
 *   the LLM is never called. The caller decides whether absence is itself a bug.
 * - All dimensions pass → { finding: null, verdicts, cropPath }: the rubric
 *   confirms there is no bug (this is how a deterministic false positive gets
 *   suppressed).
 * - Any dimension fails → a Finding with source 'rubric', all rubricVerdicts,
 *   the rubric's ruleId/category/severity, the highest-confidence failing
 *   discrepancy as the description, and confidence = mean of failing confidences.
 * - Persistent API failure (after retries) → { finding: null, verdicts: [] }:
 *   we could not reach a verdict, so we emit nothing and leave any deterministic
 *   finding untouched (uncertain semantics).
 *
 * Throws only on a contract violation in the model's response (malformed
 * verdicts), surfacing the raw output for debugging. Those are not retried.
 */
export async function evaluateRubric(rubric: Rubric, input: RubricInput): Promise<RubricResult> {
  const url =
    typeof input.pageContext?.url === 'string' ? input.pageContext.url : input.page.url();
  const judgeModel = input.judgeModel ?? DEFAULT_MODEL;
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  // 1. Capture the element crop. Absent/invisible → no finding, no LLM call.
  const slug = createHash('sha1').update(`${rubric.id}:${url}`).digest('hex').slice(0, 12);
  const cropPath = join(input.cropOutputDir, input.runId, `${rubric.id}-${slug}.png`);
  let cropBase64: string;
  try {
    await captureCrop(input.page, input.element, cropPath);
    cropBase64 = readFileSync(cropPath).toString('base64');
  } catch (err) {
    if (err instanceof ElementNotVisibleError) {
      return { finding: null, verdicts: [], cropPath: '' };
    }
    throw err;
  }

  // 2. Resolve the client. With no key and no injected client we cannot judge —
  //    treat as a soft failure (uncertain): emit nothing.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const client = input.client ?? (apiKey ? new Anthropic({ apiKey }) : undefined);
  if (!client) {
    return { finding: null, verdicts: [], cropPath };
  }

  // 3. Call the LLM (transient errors retried). Parse runs OUTSIDE the retry so
  //    a malformed-but-successful response throws loudly instead of being soft-
  //    failed. Persistent transport failure soft-fails to a null finding.
  let rawInput: unknown;
  try {
    rawInput = await withRetries(
      () => callLLM(client, rubric, input, cropBase64, judgeModel),
      retryDelayMs,
    );
  } catch {
    return { finding: null, verdicts: [], cropPath };
  }

  const verdicts = parseVerdicts(rawInput, rubric.id, judgeModel);

  // 4. No failing dimension → rubric confirms no bug.
  const failing = verdicts.filter((v) => v.verdict === 'fail');
  if (failing.length === 0) {
    return { finding: null, verdicts, cropPath };
  }

  // 5. Build the Finding. Strongest (highest-confidence) failure drives the
  //    description; overall confidence is the mean of the failing confidences.
  const strongest = failing.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  const meanConfidence = failing.reduce((sum, v) => sum + v.confidence, 0) / failing.length;
  const description = strongest.discrepancy ?? rubric.context;

  const base = buildFinding({
    runId: input.runId,
    url,
    ruleId: rubric.ruleId,
    category: rubric.category,
    severity: rubric.severity,
    title: rubric.label,
    description,
    confidence: meanConfidence,
    cropPath,
  });

  const finding: Finding = {
    ...base,
    source: 'rubric',
    confidence: meanConfidence,
    rubricVerdicts: verdicts,
  };

  return { finding, verdicts, cropPath };
}
