import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BugInstance } from '../src/types.js';
import { deduplicateBugs } from '../src/dedupe/fingerprint.js';
import { buildDocx } from '../src/report/docx-builder.js';

const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const OUTPUT_DIR = join(process.cwd(), 'output');
const DATE = new Date().toISOString().slice(0, 10);

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const lines = readFileSync(BUGS_PATH, 'utf8')
    .split('\n')
    .filter(Boolean);

  const instances: BugInstance[] = lines.map((l) => JSON.parse(l) as BugInstance);
  console.log(`Read ${instances.length} bug instances from bugs.jsonl`);

  const records = deduplicateBugs(instances);
  console.log(`Deduplicated to ${records.length} unique bugs`);

  const breakdown = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of records) breakdown[r.severity]++;
  console.log('Breakdown:', breakdown);

  const buffer = await buildDocx(records, {
    crawlDate: DATE,
    totalPages: new Set(instances.map((i) => i.url)).size,
    sites: ['ryzesuperfoods.com', 'shop.ryzesuperfoods.com'],
  });

  const outPath = join(OUTPUT_DIR, `audit-report-${DATE}.docx`);
  writeFileSync(outPath, buffer);
  console.log(`\nReport saved: ${outPath}`);
  console.log(`Total unique bugs: ${records.length} (Critical: ${breakdown.critical}, High: ${breakdown.high}, Medium: ${breakdown.medium}, Low: ${breakdown.low})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
