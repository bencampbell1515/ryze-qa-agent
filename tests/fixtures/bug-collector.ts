import { test as base, type TestInfo } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BugInstance } from '../../src/types.js';

const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');


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

export const test = base.extend<{ bugs: BugCollector }>({
  // Event listeners are attached by attachConsoleListeners / attachNetworkListeners
  // in the test body to carry the correct viewport label. Do not add them here.
  bugs: async ({ page: _page }, use, testInfo) => {
    const collector = new BugCollector(testInfo);
    await use(collector);
    // Don't flush partial data when the test failed and Playwright will retry it
    const willRetry = testInfo.status !== 'passed' && testInfo.retry < testInfo.project.retries;
    if (!willRetry) collector.flush();
  },
});

export { expect } from '@playwright/test';
