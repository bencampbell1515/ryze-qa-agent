/**
 * Refresh visual-regression baselines.
 *
 *   npx tsx scripts/baseline-update.ts [template-id ...]
 *
 * With no arguments, refreshes baselines for ALL templates. With one or more
 * template IDs, refreshes only those. Prints every file it writes.
 *
 * Does NOT auto-commit: baselines must be eyeballed before committing so a
 * regression doesn't get baked in as the new "correct" reference.
 */

import { chromium } from '@playwright/test';
import { captureTemplate, type CaptureConfig } from '../src/visual-regression/capture.js';
import { TEMPLATES } from '../src/visual-regression/templates.js';

const BASELINE_DIR = './baselines';
const OUTPUT_DIR = './output/visual';

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((id) => !TEMPLATES.some((t) => t.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown template id(s): ${unknown.join(', ')}`);
    console.error(`Known templates: ${TEMPLATES.map((t) => t.id).join(', ')}`);
    process.exit(1);
  }

  const templates =
    requested.length > 0 ? TEMPLATES.filter((t) => requested.includes(t.id)) : TEMPLATES;

  const config: CaptureConfig = {
    baselineDir: BASELINE_DIR,
    outputDir: OUTPUT_DIR,
    isBaseline: true,
  };

  console.log(
    `Refreshing baselines for ${templates.length} template(s) → ${BASELINE_DIR}\n`,
  );

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let written = 0;
  try {
    for (const template of templates) {
      console.log(`• ${template.id} (${template.label}) — ${template.representativeUrl}`);
      const results = await captureTemplate(browser, template, config);
      for (const r of results) {
        console.log(`    wrote ${r.path}`);
        written++;
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nDone. Wrote ${written} baseline image(s).`);
  console.log('Review the images, then commit them. (Not auto-committed.)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
