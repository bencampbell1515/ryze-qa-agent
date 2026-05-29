import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Finding } from '../types/finding.js';

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
   *  consumers; not cleared by flush(). */
  all(): Finding[];
  /** Append any findings not yet written to the on-disk JSONL. Idempotent:
   *  calling twice does not truncate or duplicate. */
  flush(): Promise<void>;
}

class FindingCollectorImpl implements FindingCollector {
  private findings: Finding[] = [];
  /** Index into `findings` of the first not-yet-written entry. */
  private flushedCount = 0;

  constructor(
    private readonly outputPath: string,
    private readonly runId?: string,
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

  async flush(): Promise<void> {
    const pending = this.findings.slice(this.flushedCount);
    if (pending.length === 0) return; // empty / already-flushed → no file, no-op
    mkdirSync(dirname(this.outputPath), { recursive: true });
    for (const f of pending) {
      appendFileSync(this.outputPath, JSON.stringify(f) + '\n');
    }
    this.flushedCount = this.findings.length;
  }
}

/**
 * Create a FindingCollector.
 * @param outputPath defaults to `data/findings.jsonl`; override for tests.
 * @param runId stamped onto findings that don't already carry one.
 */
export function createFindingCollector(
  outputPath?: string,
  runId?: string,
): FindingCollector {
  return new FindingCollectorImpl(outputPath ?? DEFAULT_FINDINGS_PATH, runId);
}
