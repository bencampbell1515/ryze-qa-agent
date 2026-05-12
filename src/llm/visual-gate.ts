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
