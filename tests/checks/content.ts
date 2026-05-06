import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const CSPELL_BIN = join(process.cwd(), 'node_modules', '.bin', 'cspell');
const TMP_DIR = join(process.cwd(), 'data', 'tmp');

import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

export async function runContentCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  const url = page.url();

  // Extract brand-copy text only: headings, buttons, nav, labels.
  // Excludes review/UGC sections to avoid flagging customer names and foreign-language reviews.
  const text = await page.evaluate(() => {
    const COPY_SELECTORS = 'h1, h2, h3, h4, h5, h6, button, [role="button"], label, nav a, .product__title, .product-title, [class*="product__description"] p, [class*="hero"] p';
    const REVIEW_PATTERN = /review|testimonial|okendo|judge|loox|yotpo|stamped|spr-review/i;

    function isInReviewSection(el: Element): boolean {
      let cur: Element | null = el;
      while (cur) {
        if (REVIEW_PATTERN.test(cur.className + (cur.id ?? ''))) return true;
        cur = cur.parentElement;
      }
      return false;
    }

    const elements = Array.from(document.querySelectorAll(COPY_SELECTORS));
    return elements
      .filter(el => !isInReviewSection(el))
      .map(el => el.textContent?.trim() ?? '')
      .filter(t => t.length > 2)
      .join('\n');
  });

  if (!text.trim()) return;
  if (!existsSync(CSPELL_BIN)) return; // skip if cspell not installed

  // Ensure tmp dir exists inside project so cspell can resolve config paths
  mkdirSync(TMP_DIR, { recursive: true });
  const tmpFile = join(TMP_DIR, `ryze-content-${viewport}-${randomUUID()}.txt`);

  try {
    const sanitized = text.replace(/­/g, ''); // strip soft hyphens — splits words in cspell
    writeFileSync(tmpFile, sanitized);

    let stdout = '';
    try {
      const result = await execFileAsync(
        CSPELL_BIN,
        [tmpFile, '--words-only', '--no-progress', '--config', join(process.cwd(), 'cspell.json')],
        { encoding: 'utf8', timeout: 15_000 },
      );
      stdout = result.stdout.trim();
    } catch (err) {
      // cspell exits non-zero when typos found — parse stdout from the error
      stdout = ((err as any).stdout ?? '').trim();
    }

    if (stdout) {
      for (const word of stdout.split('\n').filter(Boolean)) {
        bugs.add({
          ruleId: 'content:typo',
          severity: 'low',
          bugClass: 'content',
          message: `Possible typo: "${word.trim()}"`,
          url,
          viewport,
        });
      }
    }
  } finally {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  }
}
