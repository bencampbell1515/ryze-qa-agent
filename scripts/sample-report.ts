/**
 * Dev/PR helper (worktree-L): render the three-tier sample report from the
 * shared fixture and screenshot it, so the PR can show before (main-only,
 * hero-shot era) vs after (three tiers + element-crop references).
 *
 * Not part of any pipeline. Run with: npx tsx scripts/sample-report.ts
 * Outputs to output/: sample-report-before.{html,png}, sample-report-after.{html,png}.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { buildHtml } from '../src/report/html-builder.js';
import { SAMPLE_META, SAMPLE_MAIN_BUGS, sampleTiers } from '../tests/fixtures/three-tier-sample.js';

const OUT = join(process.cwd(), 'output');

async function shoot(htmlPath: string, pngPath: string): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.screenshot({ path: pngPath, fullPage: true });
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  // BEFORE: main list only, no tiers (the legacy report shape).
  const beforeHtml = await buildHtml(SAMPLE_MAIN_BUGS, SAMPLE_META);
  const beforePath = join(OUT, 'sample-report-before.html');
  writeFileSync(beforePath, beforeHtml, 'utf8');

  // AFTER: three tiers — main + uncertain (two-judge/rubric) + hygiene.
  const afterHtml = await buildHtml(SAMPLE_MAIN_BUGS, SAMPLE_META, undefined, sampleTiers());
  const afterPath = join(OUT, 'sample-report-after.html');
  writeFileSync(afterPath, afterHtml, 'utf8');

  await shoot(beforePath, join(OUT, 'sample-report-before.png'));
  await shoot(afterPath, join(OUT, 'sample-report-after.png'));

  console.log('Wrote sample-report-{before,after}.{html,png} to output/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
