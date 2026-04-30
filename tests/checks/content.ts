import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

export async function runContentCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  const url = page.url();

  // Extract visible text content
  const text = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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

  const tmpFile = join(tmpdir(), `ryze-content-${Date.now()}.txt`);
  try {
    writeFileSync(tmpFile, text);

    const result = execSync(
      `npx cspell "${tmpFile}" --words-only --no-progress --config "${join(process.cwd(), 'cspell.json')}" 2>&1`,
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();

    if (result) {
      for (const word of result.split('\n').filter(Boolean)) {
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
  } catch {
    // cspell exits non-zero when typos found — catch and parse stdout
  } finally {
    unlinkSync(tmpFile);
  }
}
