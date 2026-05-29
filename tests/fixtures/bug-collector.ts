import { test as base, type TestInfo } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BugInstance } from '../../src/types.js';
import { createFindingCollector, type FindingCollector } from '../../src/findings/index.js';

const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const FINDINGS_PATH = join(process.cwd(), 'data', 'findings.jsonl');
const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');

/**
 * The run id stamped onto every v2 Finding (worktree M). In a daemon run the
 * runner-daemon passes the real Firestore run id via RUN_ID. For a local
 * `npm run test:audit` there's no daemon, so we fall back to a date-based id —
 * stable across the desktop/tablet/mobile Playwright projects within one day so
 * findings from the same audit share a runId. Fingerprints don't depend on
 * runId (only the finding `id` does), so this fallback is purely cosmetic for
 * local dev. */
export function resolveRunId(): string {
  return process.env.RUN_ID || `run-local-${new Date().toISOString().slice(0, 10)}`;
}


export class BugCollector {
  private bugs: BugInstance[] = [];
  private testInfo: TestInfo;

  constructor(testInfo: TestInfo) {
    this.testInfo = testInfo;
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  add(partial: Omit<BugInstance, 'timestamp'>): void {
    this.bugs.push({ ...partial, timestamp: new Date().toISOString() });
  }

  flush(): void {
    for (const bug of this.bugs) {
      appendFileSync(BUGS_PATH, JSON.stringify(bug) + '\n');
    }
    this.bugs = [];
  }

  get collected(): BugInstance[] {
    return [...this.bugs];
  }
}

export const test = base.extend<{ bugs: BugCollector; findings: FindingCollector }>({
  // Event listeners are attached by attachConsoleListeners / attachNetworkListeners
  // in the test body to carry the correct viewport label. Do not add them here.
  bugs: async ({ page: _page }, use, testInfo) => {
    const collector = new BugCollector(testInfo);
    await use(collector);
    // Don't flush partial data when the test failed and Playwright will retry it
    const willRetry = testInfo.status !== 'passed' && testInfo.retry < testInfo.project.retries;
    if (!willRetry) collector.flush();
  },

  // worktree M: the canonical Finding stream, written alongside bugs.jsonl. Same
  // retry guard as `bugs` so a retried test doesn't double-write findings.
  findings: async ({ page: _page }, use, testInfo) => {
    const collector = createFindingCollector(FINDINGS_PATH, resolveRunId());
    await use(collector);
    const willRetry = testInfo.status !== 'passed' && testInfo.retry < testInfo.project.retries;
    if (!willRetry) await collector.flush();
  },
});

export { expect } from '@playwright/test';
