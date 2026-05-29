import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BugInstance } from '../src/types.js';
import { deduplicateBugs } from '../src/dedupe/fingerprint.js';
import { buildHtml } from '../src/report/html-builder.js';
import { readReportTiers } from '../src/report/finding-reader.js';
import { exportPdf } from '../src/report/pdf-exporter.js';

const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const OUTPUT_DIR = join(process.cwd(), 'output');
const URL_LIST_PATH = join(process.cwd(), 'output', 'url-list.json');
const DATE = new Date().toISOString().slice(0, 10);

// Third-party hosts whose failures are expected under bot user-agent
const NOISE_HOSTS = [
  'klaviyo.com', 'gorgias.com', 'connect.facebook.net', 'facebook.com',
  'analytics.tiktok.com', 'tiktok.com', 'googletagmanager.com',
  'google-analytics.com', 'doubleclick.net', 'snapchat.com', 'trkn.us',
  'shoplift.ai', 't.vibe.co', 'monorail-edge.shopifysvc.com',
  'applovin.com', 'sentry.io', 'postscript.io', 'clarity.ms',
  'mountain.com', 'launchdarkly.com', 'segment.com', 'amplitude.com',
  'intercom.io', 'hotjar.com', 'zendesk.com',
  'otlp-http-production.shopifysvc.com',
  'id.ryzesuperfoods.com',
  'api.rechargeapps.com',
  'myshopify.com',
];

const NOISE_RULE_IDS = new Set([
  'network:nav-failed',
  'network:429',
  'network:503',
  'revenue:no-atc',
  'js:pageerror',
  'console:error',
  'network:failed',
  'content:tap-target-too-small',
]);

const NOISE_404_URL_PATTERNS = [
  /\/em-prerender/,
  /\/em-cgi\//,
  /\/em-js\//,
  /cdn\.shopify\.com\/s\/files\/.*\/t\/(?!2676\/)[0-9]+\//,
  /\/t\?event=/,
];

function isNoise(inst: BugInstance): boolean {
  if (NOISE_RULE_IDS.has(inst.ruleId)) return true;

  if (inst.ruleId.startsWith('network:4')) {
    if (NOISE_404_URL_PATTERNS.some((p) => p.test(inst.message))) return true;
  }

  if (inst.ruleId.startsWith('network:4') || inst.ruleId.startsWith('network:5')) {
    const urlMatch = inst.message.match(/https?:\/\/([^/\s]+)/);
    if (urlMatch) {
      const host = urlMatch[1];
      if (NOISE_HOSTS.some((h) => host.endsWith(h))) return true;
    }
  }

  return false;
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const lines = readFileSync(BUGS_PATH, 'utf8').split('\n').filter(Boolean);
  const allInstances: BugInstance[] = lines.map((l) => JSON.parse(l) as BugInstance);
  console.log(`Read ${allInstances.length} bug instances from bugs.jsonl`);

  // ACCUM-001: Warn if bugs.jsonl contains data from multiple runs (>2h span)
  if (allInstances.length >= 2) {
    const first = allInstances[0];
    const last = allInstances[allInstances.length - 1];
    if (first.timestamp && last.timestamp) {
      const oldestMs = new Date(first.timestamp).getTime();
      const newestMs = new Date(last.timestamp).getTime();
      const spanHours = (newestMs - oldestMs) / (1000 * 60 * 60);
      if (spanHours > 2) {
        const oldest = new Date(first.timestamp).toISOString();
        const newest = new Date(last.timestamp).toISOString();
        console.warn(`⚠️  bugs.jsonl contains data from multiple runs (oldest: ${oldest}, newest: ${newest}). Run npm run clean to reset.`);
      }
    }
  }

  const instances = allInstances.filter((i) => !isNoise(i));
  console.log(`After noise filtering: ${instances.length} instances (removed ${allInstances.length - instances.length})`);

  const records = deduplicateBugs(instances);
  console.log(`Deduplicated to ${records.length} unique bugs`);

  const breakdown = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of records) breakdown[r.severity]++;
  console.log('Breakdown:', breakdown);

  // ACCUM-002: Read totalPages from url-list.json if available, else fall back to bug URLs
  let totalPages: number;
  if (existsSync(URL_LIST_PATH)) {
    const urlList = JSON.parse(readFileSync(URL_LIST_PATH, 'utf8')) as Record<string, string[]>;
    totalPages = Object.values(urlList).flat().length;
  } else {
    totalPages = new Set(instances.map((i) => i.url)).size;
  }

  const sites = ['ryzesuperfoods.com', 'shop.ryzesuperfoods.com'];

  const scoredRecords = records.map((r) => ({
    ...r,
    score: 0,
    source: 'playwright' as const,
    confidence: 1.0,
    consensusCount: 1,
  }));
  // worktree-L: surface the rebuilt pipeline's v2 tiers (uncertain + hygiene)
  // alongside the legacy ScoredBug main list. Safe when the files are absent —
  // readReportTiers returns empty arrays and the report renders empty placeholders.
  const tiers = await readReportTiers(join(process.cwd(), 'data'));
  console.log(`Tiers: ${tiers.uncertain.length} uncertain, ${tiers.hygiene.length} hygiene, ${tiers.suppressed.length} suppressed`);
  const html = await buildHtml(scoredRecords, { crawlDate: DATE, totalPages, sites }, undefined, tiers);
  const htmlPath = join(OUTPUT_DIR, `audit-report-${DATE}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`HTML report written to ${htmlPath}`);

  const pdfPath = join(OUTPUT_DIR, `audit-report-${DATE}.pdf`);
  try {
    await exportPdf(htmlPath, pdfPath);
    console.log(`PDF report written to ${pdfPath}`);
  } catch (err) {
    console.warn('PDF export failed:', (err as Error).message);
  }

  console.log(`\nTotal unique bugs: ${records.length} (Critical: ${breakdown.critical}, High: ${breakdown.high}, Medium: ${breakdown.medium}, Low: ${breakdown.low})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
