// scripts/dismiss.ts
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DismissedEntry } from '../src/types.js';

const DISMISSED_PATH = join(process.cwd(), 'data', 'dismissed.jsonl');

const args = process.argv.slice(2);
const fingerprintFlag = args.indexOf('--fingerprint');
const reasonFlag = args.indexOf('--reason');

if (fingerprintFlag === -1 || reasonFlag === -1) {
  console.error('Usage: npm run dismiss -- --fingerprint <id> --reason "<reason>"');
  process.exit(1);
}

const fingerprint = args[fingerprintFlag + 1];
const reason = args[reasonFlag + 1];

if (!fingerprint || !reason) {
  console.error('Both --fingerprint and --reason are required.');
  process.exit(1);
}

// Check for duplicates
if (existsSync(DISMISSED_PATH)) {
  const existing = readFileSync(DISMISSED_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as DismissedEntry);
  if (existing.some((e) => e.fingerprint === fingerprint)) {
    console.log(`ℹ️  Fingerprint ${fingerprint} already dismissed.`);
    process.exit(0);
  }
}

const entry: DismissedEntry = {
  fingerprint,
  reason,
  dismissedAt: new Date().toISOString(),
};

appendFileSync(DISMISSED_PATH, JSON.stringify(entry) + '\n');
console.log(`✅ Dismissed ${fingerprint}: "${reason}"`);
