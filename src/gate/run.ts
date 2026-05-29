import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'node:fs';
import type { Finding } from '../types/finding.js';
import { withRetries } from '../llm/retry.js';
import type { GateInput, GateResult, GateVerdict } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 512;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_SUPPRESS_THRESHOLD = 0.8;

const SYSTEM_PROMPT = `You are validating a UI bug claim from an automated QA audit against a cropped screenshot of the flagged element.

The audit's deterministic checks sometimes fire on edge cases their logic didn't anticipate: a title that loaded asynchronously gets flagged "missing", a slow-but-valid CDN image gets flagged "broken", a 304 gets flagged "failed". Your job is to look at the rendered crop and decide whether the claim is actually true.

Verdicts (submit via the submit_verdict tool only):
- "confirmed" — the screenshot supports the claim; the defect is really there.
- "refuted"   — the screenshot clearly CONTRADICTS the claim (e.g. the "missing" title is plainly visible, the "broken" image is rendering fine).
- "uncertain" — the crop doesn't let you decide either way.

Be conservative: only return "refuted" if the screenshot clearly contradicts the claim. When in doubt, return "uncertain". A wrong "refuted" hides a real bug, so the bar for refuting is high.`;

const TOOL_SCHEMA = {
  name: 'submit_verdict',
  description: 'Submit the validation verdict for this bug claim.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string' as const, enum: ['confirmed', 'refuted', 'uncertain'] },
      confidence: { type: 'number' as const, description: '0.0 to 1.0 — how sure you are of the verdict' },
      reasoning: { type: 'string' as const, description: 'One line explaining the verdict; required for refuted/uncertain' },
    },
    required: ['verdict', 'confidence'],
  },
};

const VALID_VERDICTS: ReadonlySet<string> = new Set(['confirmed', 'refuted', 'uncertain']);

function buildUserContent(
  finding: Finding,
  cropBase64: string,
  pageContext?: Record<string, string | number | boolean | null>,
): Anthropic.MessageParam['content'] {
  const text = [
    `CLAIM (${finding.ruleId}, severity ${finding.severity}):`,
    `Title: ${finding.title}`,
    `Description: ${finding.description}`,
    `Page URL: ${finding.url}`,
    `PAGE CONTEXT:\n${JSON.stringify(pageContext ?? {}, null, 2)}`,
    '',
    'The cropped screenshot of the flagged element is attached. Is the claim true?',
  ].join('\n');

  return [
    { type: 'text', text },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: cropBase64 } },
  ];
}

async function callAndParse(
  client: Anthropic,
  finding: Finding,
  cropBase64: string,
  model: string,
  pageContext: Record<string, string | number | boolean | null> | undefined,
): Promise<GateResult> {
  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'submit_verdict' },
    messages: [{ role: 'user', content: buildUserContent(finding, cropBase64, pageContext) }],
  });
  const block = response.content.find((b) => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
  if (!block) throw new Error(`Gate verdict parse failed (no tool_use block): ${JSON.stringify(response.content)}`);
  const input = block.input as { verdict?: unknown; confidence?: unknown; reasoning?: unknown };
  if (typeof input.verdict !== 'string' || !VALID_VERDICTS.has(input.verdict)) {
    throw new Error(`Gate verdict parse failed (invalid verdict): ${JSON.stringify(input)}`);
  }
  if (typeof input.confidence !== 'number' || Number.isNaN(input.confidence)) {
    throw new Error(`Gate verdict parse failed (invalid confidence): ${JSON.stringify(input)}`);
  }
  return {
    verdict: input.verdict as GateVerdict,
    confidence: input.confidence,
    ...(typeof input.reasoning === 'string' && input.reasoning ? { reasoning: input.reasoning } : {}),
    judgeModel: model,
  };
}

/**
 * Evaluate a single finding's claim against its element crop.
 *
 * Outcomes:
 * - No crop (missing path or file) → `uncertain`, confidence 0, no LLM call.
 *   The gate can't validate what it can't see.
 * - No API key and no injected client → `uncertain`, no LLM call (graceful, like
 *   the v1 visual gate's no-key path).
 * - LLM reachable → forced tool-use `submit_verdict`, parsed inside the retry so
 *   a malformed-but-successful response is retried. Persistent transport OR
 *   parse failure soft-fails to `uncertain` (we never throw, never suppress on
 *   an unreadable verdict).
 */
export async function evaluateGate(input: GateInput): Promise<GateResult> {
  const judgeModel = input.judgeModel ?? DEFAULT_MODEL;
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  if (!input.cropPath || !existsSync(input.cropPath)) {
    return { verdict: 'uncertain', confidence: 0, reasoning: 'no crop available', judgeModel };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const client = input.client ?? (apiKey ? new Anthropic({ apiKey }) : undefined);
  if (!client) {
    return { verdict: 'uncertain', confidence: 0, reasoning: 'gate skipped: no ANTHROPIC_API_KEY', judgeModel };
  }

  const cropBase64 = readFileSync(input.cropPath).toString('base64');

  try {
    return await withRetries(
      () => callAndParse(client, input.finding, cropBase64, judgeModel, input.pageContext),
      retryDelayMs,
    );
  } catch {
    return { verdict: 'uncertain', confidence: 0, reasoning: 'gate failed after retries', judgeModel };
  }
}

/**
 * Apply a gate verdict to a finding. Returns a copy of the finding with
 * `visualGate` populated, or `null` when the verdict was a high-confidence
 * `refuted` (suppress). Never mutates the input.
 *
 * - confirmed                       → visualGate.verdict = 'visible'
 * - refuted, confidence >= threshold → null (suppress)
 * - refuted, confidence <  threshold → visualGate.verdict = 'uncertain'
 * - uncertain                        → visualGate.verdict = 'uncertain'
 */
export function applyGateResult(
  finding: Finding,
  result: GateResult,
  suppressThreshold: number = DEFAULT_SUPPRESS_THRESHOLD,
): Finding | null {
  if (result.verdict === 'refuted' && result.confidence >= suppressThreshold) {
    return null;
  }
  const verdict = result.verdict === 'confirmed' ? 'visible' : 'uncertain';
  return {
    ...finding,
    visualGate: {
      verdict,
      reason: result.reasoning ?? '',
      judgeModel: result.judgeModel,
    },
  };
}
