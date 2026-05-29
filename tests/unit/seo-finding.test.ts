import { test, expect, chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSeoCheck } from '../checks/seo.js';
import { createFindingCollector } from '../../src/findings/index.js';
import type { BugInstance } from '../../src/types.js';

function fakeBugs() {
  const collected: Array<Omit<BugInstance, 'timestamp'>> = [];
  return { collected, add: (b: Omit<BugInstance, 'timestamp'>) => collected.push(b) };
}

test('seo: dual-write emits a Finding alongside the missing-canonical bug', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-seo-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    page.setDefaultTimeout(2000); // missing-element getAttribute() auto-waits; fail fast
    // A bare page: title present but no canonical, no meta description, no og:title.
    await page.setContent('<!DOCTYPE html><html><head><title>Ryze Home Page</title></head><body></body></html>');

    const findings = createFindingCollector(join(dir, 'f.jsonl'), 'run-seo');
    const bugs = fakeBugs();
    await runSeoCheck(page, bugs as any, 'desktop', { findings, runId: 'run-seo' });

    // Bug stream unchanged.
    expect(bugs.collected.find((b) => b.ruleId === 'seo:missing-canonical')).toBeDefined();

    // Finding stream additively gets the same issue.
    const f = findings.all().find((x) => x.ruleId === 'seo:missing-canonical');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('high');
    expect(f!.category).toBe('seo');
    expect(f!.source).toBe('deterministic');
    expect(f!.runId).toBe('run-seo');

    await page.close();
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seo: without a dual-write context, only the bug stream is written (legacy 3-arg call)', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    page.setDefaultTimeout(2000); // missing-element getAttribute() auto-waits; fail fast
    await page.setContent('<!DOCTYPE html><html><head><title>Ryze Home Page</title></head><body></body></html>');
    const bugs = fakeBugs();
    await runSeoCheck(page, bugs as any, 'desktop');
    expect(bugs.collected.find((b) => b.ruleId === 'seo:missing-canonical')).toBeDefined();
    await page.close();
  } finally {
    await browser.close();
  }
});
