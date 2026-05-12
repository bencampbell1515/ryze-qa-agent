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

const GATED_RULE_IDS = new Set([
  'content:broken-image',
  'content:empty-image-src',
  'content:broken-picture-template',
  'network:404',
  'network:4xx',
  'network:failed',
  'network:nav-failed',
]);

export async function gateRecords(records: BugRecord[]): Promise<GateResult> {
  if (process.env.DISABLE_VISUAL_GATE === '1') {
    return { kept: [...records], suppressed: [], failedCount: 0, totalGated: 0 };
  }

  // Separate records into gated (in-scope) and non-gated (out-of-scope)
  const inScope: BugRecord[] = [];
  const outOfScope: BugRecord[] = [];

  for (const record of records) {
    if (GATED_RULE_IDS.has(record.ruleId)) {
      inScope.push(record);
    } else {
      outOfScope.push(record);
    }
  }

  // If no API key, mark in-scope records with verdict='uncertain' and return
  if (!process.env.ANTHROPIC_API_KEY) {
    const fallback = inScope.map((r) => ({
      ...r,
      verdict: 'uncertain' as const,
      verdictReason: 'gate skipped: no ANTHROPIC_API_KEY',
    }));
    return {
      kept: [...outOfScope, ...fallback],
      suppressed: [],
      failedCount: inScope.length,
      totalGated: inScope.length,
    };
  }

  // TODO: LLM verdict logic will be implemented in subsequent tasks
  // For now, mirror the no-key behavior
  const fallback = inScope.map((r) => ({
    ...r,
    verdict: 'uncertain' as const,
    verdictReason: 'gate skipped: LLM verdict not yet implemented',
  }));
  return {
    kept: [...outOfScope, ...fallback],
    suppressed: [],
    failedCount: 0,
    totalGated: inScope.length,
  };
}
