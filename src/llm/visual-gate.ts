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
  /** Records that survived the gate (verdict='visible' | 'uncertain' | undefined) */
  kept: BugRecord[];
  /** Records the LLM judged not-visible to a shopper */
  suppressed: BugRecord[];
  /** Count of records whose LLM verdict failed after all retries */
  failedCount: number;
  /** Total number of records that were sent through the gate (i.e., in scope) */
  totalGated: number;
};

export type GateOptions = {
  /** Optional injected client — used by tests; in production we construct from env */
  client?: Anthropic;
  /** Override base retry delay (default 1000ms). Tests use 1ms. */
  retryDelayMs?: number;
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
      const delay = retryDelayMs * Math.pow(3, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
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
  const retryDelayMs = opts.retryDelayMs ?? 1000;
  const kept: BugRecord[] = [...outOfScope];
  const suppressed: BugRecord[] = [];
  let failedCount = 0;

  for (const r of inScope) {
    try {
      const v = await withRetries(() => callLLMForVerdict(client, r), retryDelayMs);
      const annotated = { ...r, verdict: v.verdict, verdictReason: v.reason };
      if (v.verdict === 'not-visible') suppressed.push(annotated);
      else kept.push(annotated);
    } catch (err) {
      failedCount++;
      console.warn(`[visual-gate] ${r.fingerprint} failed: ${(err as Error).message}`);
      kept.push({ ...r, verdict: 'uncertain', verdictReason: 'gate failed after retries' });
    }
  }

  if (inScope.length > 0 && failedCount / inScope.length > 0.5) {
    throw new Error(
      `visual gate failed: ${failedCount} of ${inScope.length} records could not be validated (>50%). Rerun \`npm run report\` to retry without redoing the audit.`,
    );
  }

  return { kept, suppressed, failedCount, totalGated: inScope.length };
}
