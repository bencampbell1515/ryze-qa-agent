import { test as base, type TestInfo } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BugInstance, Severity, BugClass, Viewport } from '../../src/types.js';

const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');

const NOISE_HOSTS = [
  'klaviyo.com',
  'gorgias.com',
  'connect.facebook.net',
  'facebook.com',
  'analytics.tiktok.com',
  'tiktok.com',
  'googletagmanager.com',
  'google-analytics.com',
  'doubleclick.net',
];

function isNoise(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return NOISE_HOSTS.some((d) => host.endsWith(d));
  } catch {
    return false;
  }
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

export const test = base.extend<{ bugs: BugCollector }>({
  bugs: async ({ page }, use, testInfo) => {
    const collector = new BugCollector(testInfo);

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      collector.add({
        ruleId: 'console:error',
        severity: 'high',
        bugClass: 'console',
        message: msg.text(),
        url: page.url(),
        viewport: 'desktop',
      });
    });

    page.on('pageerror', (err) => {
      collector.add({
        ruleId: 'js:pageerror',
        severity: 'critical',
        bugClass: 'console',
        message: err.message,
        url: page.url(),
        viewport: 'desktop',
      });
    });

    page.on('requestfailed', (req) => {
      if (isNoise(req.url())) return;
      collector.add({
        ruleId: 'network:failed',
        severity: 'high',
        bugClass: 'network',
        message: `Request failed: ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`,
        url: page.url(),
        viewport: 'desktop',
      });
    });

    page.on('response', async (res) => {
      if (res.status() < 400) return;
      if (isNoise(res.url())) return;
      const isRyze =
        res.url().includes('ryzesuperfoods.com') || res.url().includes('ryzewith.com');
      if (!isRyze) return;
      const severity: Severity = res.status() >= 500 ? 'critical' : 'high';
      collector.add({
        ruleId: `network:${res.status()}`,
        severity,
        bugClass: 'network',
        message: `HTTP ${res.status()} on ${res.url()}`,
        url: page.url(),
        viewport: 'desktop',
      });
    });

    await use(collector);
    collector.flush();
  },
});

export { expect } from '@playwright/test';
