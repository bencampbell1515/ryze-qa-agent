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

  // Extract visible text content, skipping script/style and aria-hidden elements
  const text = await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node: Node): number {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
          if (parent.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    const texts: string[] = [];
    let node: Node | null = walker.nextNode();
    while (node) {
      const t = node.textContent?.trim();
      if (t && t.length > 1) texts.push(t);
      node = walker.nextNode();
    }
    return texts.join('\n');
  });

  if (!text.trim()) return;
  if (!existsSync(CSPELL_BIN)) return; // skip if cspell not installed

  // Ensure tmp dir exists inside project so cspell can resolve config paths
  mkdirSync(TMP_DIR, { recursive: true });
  const tmpFile = join(TMP_DIR, `ryze-content-${viewport}-${randomUUID()}.txt`);

  try {
    writeFileSync(tmpFile, text);

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
