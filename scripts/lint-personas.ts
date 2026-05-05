// scripts/lint-personas.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PERSONAS_DIR = join(process.cwd(), 'personas');
const REQUIRED_SECTIONS = [
  '## Background',
  '## Mandate',
  '## Blind Spots',
  '## Evidence Requirements',
  '## How to Frame Findings',
];

const files = readdirSync(PERSONAS_DIR).filter((f) => f.endsWith('.md'));
let failed = false;

for (const file of files) {
  const content = readFileSync(join(PERSONAS_DIR, file), 'utf8');
  const missing = REQUIRED_SECTIONS.filter((s) => !content.includes(s));
  if (missing.length > 0) {
    console.error(`❌ ${file} is missing sections: ${missing.join(', ')}`);
    failed = true;
  } else {
    console.log(`✅ ${file}`);
  }
}

if (failed) process.exit(1);
console.log('\nAll persona files pass structure check.');
