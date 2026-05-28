/**
 * Manual dry-run for the worktree-D content rules against live pages.
 *
 *   npx tsx tests/cross-page/dry-run.ts
 *
 * Not a unit test (no `.test.ts` suffix, so Playwright skips it). Fetches a
 * small set of known pages via curl — Cloudflare drops Node's fetch TLS
 * fingerprint, so we shell out, mirroring src/crawl/sitemap.ts. No LLM calls.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadCanonicalRecord } from '../../src/cross-page/canonical.js';
import { checkCopyrightYear, checkBrandTerms, checkUrlTypos } from '../../src/cross-page/content-rules.js';
import type { CanonicalRecord, Finding } from '../../src/types/finding.js';

const execFileAsync = promisify(execFile);
const UA = 'RyzeQABot/0.1 (+pm@ryze.example)';
const RUN_ID = 'dry-run';

const PAGES = [
  'https://www.ryzesuperfoods.com/',
  'https://www.ryzesuperfoods.com/pages/mushroom-chicory-espanol',
  'https://www.ryzesuperfoods.com/pages/mushroom-matcha-espanol',
  'https://www.ryzesuperfoods.com/pages/mushroom-hot-cocoa-espanol',
];

async function fetchPage(url: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'curl',
    ['-sS', '-A', UA, '--max-time', '30', '--proto', '=https', '--proto-redir', '=https', url],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  return stdout;
}

/** Strip tags so brand-term / copyright scans see visible-ish text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&copy;/gi, '©')
    .replace(/\s+/g, ' ');
}

function print(label: string, findings: Finding[]) {
  console.log(`\n### ${label}: ${findings.length} finding(s)`);
  for (const f of findings.slice(0, 5)) {
    console.log(`  - [${f.severity}] ${f.ruleId} :: ${f.title}`);
    console.log(`      conf=${f.confidence} meta=${JSON.stringify(f.meta)}`);
  }
}

async function main() {
  const canonical = loadCanonicalRecord();
  console.log('Canonical acceptableCopyrightYears:', canonical.acceptableCopyrightYears);

  const urlRegistry = new Map<string, Finding>();
  let allCopyright: Finding[] = [];
  let allBrand: Finding[] = [];
  let allUrl: Finding[] = [];

  for (const url of PAGES) {
    let html: string;
    try {
      html = await fetchPage(url);
    } catch (e) {
      console.log(`  (skip ${url}: ${(e as Error).message})`);
      continue;
    }
    const text = htmlToText(html);
    allCopyright = allCopyright.concat(await checkCopyrightYear(url, text, canonical, RUN_ID));
    allBrand = allBrand.concat(await checkBrandTerms(url, text, canonical, RUN_ID));
    allUrl = allUrl.concat(await checkUrlTypos(url, html, canonical, RUN_ID, urlRegistry));
  }

  print('content:outdated-copyright (live config)', allCopyright);
  print('content:brand-term-typo', allBrand);
  print('content:url-typo', allUrl);

  // Demonstrate the copyright detector against the historical bug: the Spanish
  // pages served stale years when the report was written. They now serve the
  // current year, so prove the detector still fires by narrowing acceptable
  // years in-memory (committed config is left untouched).
  const narrowed: CanonicalRecord = { ...canonical, acceptableCopyrightYears: [2099] };
  let demo: Finding[] = [];
  for (const url of PAGES) {
    try {
      const text = htmlToText(await fetchPage(url));
      demo = demo.concat(await checkCopyrightYear(url, text, narrowed, RUN_ID));
    } catch {
      /* ignore */
    }
  }
  print('content:outdated-copyright (acceptable=[2099] demo)', demo);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
