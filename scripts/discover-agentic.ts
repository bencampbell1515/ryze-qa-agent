// scripts/discover-agentic.ts
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { runPersona } from '../src/discovery/persona-runner.js';
import type { UrlList } from '../src/types.js';

const URL_LIST_PATH = join(process.cwd(), 'output', 'url-list.json');
const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');
const OUTPUT_PATH = join(process.cwd(), 'data', 'discoveries.jsonl');

// Two batches of 2 — matches the max 2 concurrent browser context constraint
const PERSONA_BATCHES = [
  ['revenue-hawk', 'skeptical-first-timer'],
  ['brand-purist', 'forensic-technician'],
];

async function main(): Promise<void> {
  if (!existsSync(URL_LIST_PATH)) {
    console.error('output/url-list.json not found. Run npm run test:crawl first.');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — skipping agentic discovery. Writing empty discoveries.jsonl.');
    writeFileSync(OUTPUT_PATH, '');
    return;
  }

  writeFileSync(OUTPUT_PATH, ''); // reset; findings append during run

  const client = new Anthropic({ apiKey });
  const urlList = JSON.parse(readFileSync(URL_LIST_PATH, 'utf8')) as UrlList;
  const totalUrls = Object.values(urlList).flat().length;

  console.log(`\n🔍 Agentic discovery: ${totalUrls} URLs across 4 personas (2 concurrent)\n`);

  for (const batch of PERSONA_BATCHES) {
    console.log(`\n▶ Batch: ${batch.join(' + ')}`);
    await Promise.all(
      batch.map(personaName =>
        runPersona({ client, personaName, urlList, screenshotsDir: SCREENSHOTS_DIR, discoveriesPath: OUTPUT_PATH })
          .catch(err => console.warn(`  ⚠️  ${personaName} failed:`, (err as Error).message))
      )
    );
  }

  const count = existsSync(OUTPUT_PATH)
    ? readFileSync(OUTPUT_PATH, 'utf8').split('\n').filter(Boolean).length
    : 0;
  console.log(`\n✅ Agentic discovery complete: ${count} findings → ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('Agentic discovery failed:', err);
  process.exit(1);
});
