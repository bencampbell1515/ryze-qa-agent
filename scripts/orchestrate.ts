// scripts/orchestrate.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BugInstance, DiscoveryFinding, ScoredBug, BugClass, ReportHistoryEntry } from '../src/types.js';
import { deduplicateBugs, computeFingerprint } from '../src/dedupe/fingerprint.js';
import { scoreBug } from '../src/scoring/scorer.js';
import { enforceEvidence } from '../src/scoring/evidence-enforcer.js';
import { buildHtml } from '../src/report/html-builder.js';
import { exportPdf } from '../src/report/pdf-exporter.js';
import { generateSummaries } from './summarise.js';
import { assignCategories } from './categorise.js';
import Anthropic from '@anthropic-ai/sdk';

const execFileAsync = promisify(execFile);

const VALIDATED_PATH = join(process.cwd(), 'data', 'validated-bugs.jsonl');
const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const DISCOVERIES_PATH = join(process.cwd(), 'data', 'discoveries.jsonl');
const SCORED_PATH = join(process.cwd(), 'data', 'scored-bugs.json');
const HISTORY_PATH = join(process.cwd(), 'data', 'report-history.jsonl');
const OUTPUT_DIR = join(process.cwd(), 'output');
const DATE = new Date().toISOString().slice(0, 10);

function loadKnownFingerprints(): Set<string> {
  if (!existsSync(HISTORY_PATH)) return new Set();
  const entries: ReportHistoryEntry[] = readFileSync(HISTORY_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ReportHistoryEntry)
    .slice(-3);
  return new Set(entries.flatMap((e) => e.fingerprints));
}

function saveToHistory(fingerprints: string[]): void {
  const entry: ReportHistoryEntry = {
    runDate: new Date().toISOString(),
    fingerprints,
  };
  const existing = existsSync(HISTORY_PATH)
    ? readFileSync(HISTORY_PATH, 'utf8').split('\n').filter(Boolean)
    : [];
  const updated = [...existing.slice(-2), JSON.stringify(entry)];
  writeFileSync(HISTORY_PATH, updated.join('\n') + '\n');
}

async function runScript(script: string): Promise<void> {
  console.log(`\n▶ Running ${script}...`);
  try {
    await execFileAsync('npx', ['tsx', `scripts/${script}.ts`], {
      env: process.env,
      cwd: process.cwd(),
    });
  } catch (err) {
    console.warn(`⚠️  ${script} failed — continuing with fallback. Error:`, err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const client = apiKey ? new Anthropic({ apiKey }) : null;

  // Step 1: Run validation and discovery in parallel
  await Promise.all([runScript('validate'), runScript('discover-agentic')]);

  // Step 2: Load validated bugs (fall back to raw if validation failed)
  const bugsSource = existsSync(VALIDATED_PATH) ? VALIDATED_PATH : BUGS_PATH;
  if (!existsSync(bugsSource)) {
    console.error('No bug data found. Run npm run test:audit first.');
    process.exit(1);
  }

  const NOISE_RULE_IDS = new Set([
    'network:nav-failed',
    'network:429',
    'network:503',
    'revenue:no-atc',
    'js:pageerror',
    'console:error',
    'network:failed',
  ]);

  const playwrightBugs: BugInstance[] = readFileSync(bugsSource, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BugInstance)
    .filter((b) => !NOISE_RULE_IDS.has(b.ruleId));

  // Step 3: Load and validate discovery findings
  const discoveries: DiscoveryFinding[] = existsSync(DISCOVERIES_PATH)
    ? readFileSync(DISCOVERIES_PATH, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as DiscoveryFinding)
        .filter((f) => enforceEvidence(f).valid)
    : [];

  // Step 4: Detect consensus (same URL + ruleId from multiple sources)
  const consensusMap = new Map<string, number>();
  for (const b of playwrightBugs) {
    const key = `${b.url}|${b.ruleId}`;
    consensusMap.set(key, (consensusMap.get(key) ?? 0) + 1);
  }
  for (const d of discoveries) {
    const key = `${d.url}|${d.ruleId}`;
    consensusMap.set(key, (consensusMap.get(key) ?? 0) + 1);
  }

  // Step 5: Convert discoveries to BugInstance for dedup
  const discoveryAsBugs: BugInstance[] = discoveries.map((d) => ({
    ruleId: d.ruleId,
    severity: d.severity,
    bugClass: d.bugClass as BugClass,
    message: d.claim,
    url: d.url,
    viewport: 'desktop' as const,
    timestamp: d.timestamp,
    outerHTMLSnippet: d.quotedElement,
    pageScreenshot: d.screenshot,
    confidence: 1.0,
    validated: true,
  }));

  const allBugs = [...playwrightBugs, ...discoveryAsBugs];
  const deduplicated = deduplicateBugs(allBugs);

  // Step 6: Score every finding
  const knownFingerprints = loadKnownFingerprints();

  const scored: ScoredBug[] = deduplicated.map((record) => {
    const matchingBug = allBugs.find((b) => b.url === record.urls[0] && b.ruleId === record.ruleId);
    const consensusKey = `${record.urls[0]}|${record.ruleId}`;
    const consensusCount = consensusMap.get(consensusKey) ?? 1;
    const confidence = matchingBug?.confidence ?? 1.0;
    const isDiscovery = discoveries.some(
      (d) => d.ruleId === record.ruleId && d.url === record.urls[0],
    );

    // Severity floor: lone Claude discovery findings capped at Medium
    let { severity } = record;
    if (isDiscovery && consensusCount < 2 && (severity === 'critical' || severity === 'high')) {
      severity = 'medium';
    }

    const fakeBug: BugInstance = {
      ruleId: record.ruleId,
      severity,
      bugClass: record.bugClass,
      message: record.description,
      url: record.urls[0],
      viewport: record.viewports[0] ?? 'desktop',
      timestamp: new Date().toISOString(),
    };

    const score = scoreBug(fakeBug, { knownFingerprints, confidence, consensusCount });
    const discoveryPersona = discoveries.find(
      (d) => d.ruleId === record.ruleId && d.url === record.urls[0],
    )?.persona;

    return {
      ...record,
      severity,
      score,
      source: isDiscovery ? 'claude-discovery' : 'playwright',
      validated: matchingBug?.validated ?? true,
      confidence,
      consensusCount,
      discoveryPersona,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  writeFileSync(SCORED_PATH, JSON.stringify(scored, null, 2));
  console.log(`\n✅ Scored ${scored.length} findings. Top score: ${scored[0]?.score.toFixed(1) ?? 'N/A'}`);

  // Step 7: Re-verify top 10
  await runScript('reverify');

  // Step 8: Read back (reverify mutates scored-bugs.json)
  const finalScored: ScoredBug[] = JSON.parse(readFileSync(SCORED_PATH, 'utf8'));

  // Step 9: Save fingerprints to history
  saveToHistory(
    finalScored.map((b) =>
      computeFingerprint(b.ruleId, b.description, b.urls[0] ?? 'document'),
    ),
  );

  // Step 10a: Generate plain-English summaries
  console.log('\n✍️  Generating summaries...');
  const withSummaries = client
    ? await generateSummaries(client, finalScored)
    : finalScored;

  // Step 10b: Assign categories
  console.log('\n🏷️  Assigning categories...');
  const withCategories = client
    ? await assignCategories(client, withSummaries)
    : withSummaries;

  // Step 11: Build HTML report
  const reportMeta = {
    crawlDate: DATE,
    totalPages: new Set(withCategories.flatMap((b) => b.urls)).size,
    sites: ['ryzesuperfoods.com', 'shop.ryzesuperfoods.com'],
  };
  const html = await buildHtml(withCategories, reportMeta);
  const htmlPath = join(OUTPUT_DIR, `audit-report-${DATE}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`\n📄 HTML report written to ${htmlPath}`);

  // Step 12: Export PDF
  const pdfPath = join(OUTPUT_DIR, `audit-report-${DATE}.pdf`);
  try {
    await exportPdf(htmlPath, pdfPath);
    console.log(`📄 PDF report written to ${pdfPath}`);
  } catch (err) {
    console.warn('⚠️  PDF export failed — HTML report is still available:', (err as Error).message);
  }

  // Step 13: Executive summary
  const critical = withCategories.filter((b) => b.severity === 'critical').length;
  const high = withCategories.filter((b) => b.severity === 'high').length;
  const medium = withCategories.filter((b) => b.severity === 'medium').length;
  const low = withCategories.filter((b) => b.severity === 'low').length;
  console.log(`\n📊 Executive Summary:`);
  console.log(`   Critical: ${critical}  High: ${high}  Medium: ${medium}  Low: ${low}`);
  console.log(
    `   Total: ${withCategories.length} (${withCategories.filter((b) => b.source === 'claude-discovery').length} AI-discovered)`,
  );
}

main().catch((err) => {
  console.error('Orchestrator failed:', err);
  process.exit(1);
});
