import { test, expect, chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNewsletterCheck } from '../checks/newsletter.js';
import { createFindingCollector } from '../../src/findings/index.js';
import type { BugInstance } from '../../src/types.js';

function fakeBugs() {
  const collected: Array<Omit<BugInstance, 'timestamp'>> = [];
  return { collected, add: (b: Omit<BugInstance, 'timestamp'>) => collected.push(b) };
}

/**
 * A newsletter form whose email input drops its `type="email"` on blur — a
 * stand-in for a custom widget that strips native HTML5 validation and provides
 * no replacement. findNewsletterForm still detects it (type="email" at scan
 * time); after the check fills + blurs, no `input[type="email"]` reports an
 * invalid state, so runNewsletterCheck flags content:newsletter-no-validation.
 */
const FORM_HTML =
  '<!DOCTYPE html><html><body>' +
  '<form action="/newsletter">' +
  '<input type="email" name="email" onblur="this.type=\'text\'">' +
  '<button type="submit">Sign up</button>' +
  '</form></body></html>';

test('newsletter: dual-write emits a Finding alongside the no-validation bug', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-news-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.setContent(FORM_HTML);

    const findings = createFindingCollector(join(dir, 'f.jsonl'), 'run-news');
    const bugs = fakeBugs();
    await runNewsletterCheck(page, bugs as any, 'desktop', { findings, runId: 'run-news' });

    // Bug stream unchanged.
    expect(bugs.collected.find((b) => b.ruleId === 'content:newsletter-no-validation')).toBeDefined();

    // Finding stream additively gets the same issue.
    const f = findings.all().find((x) => x.ruleId === 'content:newsletter-no-validation');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('medium');
    expect(f!.category).toBe('content');
    expect(f!.source).toBe('deterministic');
    expect(f!.runId).toBe('run-news');

    await page.close();
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('newsletter: without a dual-write context, only the bug stream is written (legacy 3-arg call)', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.setContent(FORM_HTML);
    const bugs = fakeBugs();
    await runNewsletterCheck(page, bugs as any, 'desktop');
    expect(bugs.collected.find((b) => b.ruleId === 'content:newsletter-no-validation')).toBeDefined();
    await page.close();
  } finally {
    await browser.close();
  }
});
