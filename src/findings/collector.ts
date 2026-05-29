import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Finding } from '../types/finding.js';
import type { GateConfig } from '../gate/types.js';
import { runGateBatch } from '../gate/index.js';

const DEFAULT_FINDINGS_PATH = join(process.cwd(), 'data', 'findings.jsonl');

/**
 * Sibling of {@link BugCollector} (tests/fixtures/bug-collector.ts) for the
 * canonical Finding stream. Buffers findings in memory and appends them to
 * `data/findings.jsonl` on flush — one JSON object per line, append-only within
 * a run. The design intentionally mirrors BugCollector so the dual-write at
 * each check site reads symmetrically.
 */
export interface FindingCollector {
  /** Append a finding to the in-memory list (stamped with the run's runId if
   *  the finding doesn't already carry one). Synchronous to match BugCollector. */
  add(finding: Finding): void;
  /** All findings collected in this run, in insertion order. For end-of-run
   *  consumers; not cleared by flush(). Reflects gate suppressions once flushed. */
  all(): Finding[];
  /** Append any findings not yet written to the on-disk JSONL. Idempotent:
   *  calling twice does not truncate or duplicate. When the vision-confirmation
   *  gate is enabled (worktree J), the pending slice is gated before the disk
   *  write — see {@link FindingCollectorImpl.flush}. */
  flush(): Promise<void>;
}

class FindingCollectorImpl implements FindingCollector {
  private findings: Finding[] = [];
  /** Index into `findings` of the first not-yet-written entry. */
  private flushedCount = 0;

  constructor(
    private readonly outputPath: string,
    private readonly runId?: string,
    private readonly gateConfig?: GateConfig,
  ) {}

  add(finding: Finding): void {
    // Stamp the run's runId only when the finding doesn't carry its own.
    const stamped =
      this.runId && !finding.runId ? { ...finding, runId: this.runId } : finding;
    this.findings.push(stamped);
  }

  all(): Finding[] {
    return [...this.findings];
  }

  /**
   * Append the pending (not-yet-written) findings to the on-disk JSONL.
   *
   * Vision-confirmation gate (worktree J): when `RYZE_ENABLE_GATE=1` AND a
   * credential is available (`ANTHROPIC_API_KEY` in production, or an injected
   * client in tests), the pending slice is run through {@link runGateBatch}
   * BEFORE the disk write. High-confidence-refuted findings are suppressed
   * (dropped from both `findings.jsonl` and the in-memory list, logged instead
   * to a `suppressed-findings.jsonl` sibling of the output file); the rest are
   * kept with their `visualGate` verdict populated.
   *
   * The gate touches ONLY the pending slice — already-written findings are never
   * re-gated — so the idempotent/incremental flush contract holds: a second
   * flush with no new findings is still a no-op.
   */
  async flush(): Promise<void> {
    let pending = this.findings.slice(this.flushedCount);
    if (pending.length === 0) return; // empty / already-flushed → no file, no-op

    if (this.gateEnabled()) {
      const suppressedPath =
        this.gateConfig?.suppressedPath ??
        join(dirname(this.outputPath), 'suppressed-findings.jsonl');
      const { kept } = await runGateBatch(pending, { ...this.gateConfig, suppressedPath });
      // Replace the pending region in-place with the kept set so `all()` reflects
      // suppression and flushedCount stays a valid cursor into `findings`.
      this.findings = [...this.findings.slice(0, this.flushedCount), ...kept];
      pending = kept;
    }

    if (pending.length > 0) {
      mkdirSync(dirname(this.outputPath), { recursive: true });
      for (const f of pending) {
        appendFileSync(this.outputPath, JSON.stringify(f) + '\n');
      }
    }
    this.flushedCount = this.findings.length;
  }

  /** Gate runs only when explicitly opted in AND a credential is reachable.
   *  Mirrors worktree I's rubric gate so `audit-only` stays zero-cost. */
  private gateEnabled(): boolean {
    if (process.env.RYZE_ENABLE_GATE !== '1') return false;
    return Boolean(process.env.ANTHROPIC_API_KEY || this.gateConfig?.client);
  }
}

/**
 * Create a FindingCollector.
 * @param outputPath defaults to `data/findings.jsonl`; override for tests.
 * @param runId stamped onto findings that don't already carry one.
 * @param gateConfig optional vision-confirmation gate configuration (worktree
 *   J). Only consulted when `RYZE_ENABLE_GATE=1`. Tests inject a `client` here;
 *   production leaves it undefined and the gate builds one from
 *   `ANTHROPIC_API_KEY`.
 */
export function createFindingCollector(
  outputPath?: string,
  runId?: string,
  gateConfig?: GateConfig,
): FindingCollector {
  return new FindingCollectorImpl(outputPath ?? DEFAULT_FINDINGS_PATH, runId, gateConfig);
}
