// scripts/discover.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { DiscoveryFinding, UrlList } from '../src/types.js';
import { enforceEvidence } from '../src/scoring/evidence-enforcer.js';

const URL_LIST_PATH = join(process.cwd(), 'output', 'url-list.json');
const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');
const PERSONAS_DIR = join(process.cwd(), 'personas');
const OUTPUT_PATH = join(process.cwd(), 'data', 'discoveries.jsonl');

const PERSONAS = [
  'revenue-hawk',
  'skeptical-first-timer',
  'brand-purist',
  'forensic-technician',
];

function loadPersona(name: string): string {
  const path = join(PERSONAS_DIR, `${name}.md`);
  if (!existsSync(path)) throw new Error(`Persona file not found: ${path}`);
  return readFileSync(path, 'utf8');
}

function getScreenshotsForUrl(url: string): string[] {
  const urlSlug = url.replace(/https?:\/\//, '').replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '');
  const viewports = ['desktop', 'tablet', 'mobile'];
  return viewports
    .map((v) => join(SCREENSHOTS_DIR, `${urlSlug}-${v}.png`))
    .filter(existsSync);
}

async function runPersonaAgent(
  client: Anthropic,
  personaName: string,
  urls: string[],
): Promise<DiscoveryFinding[]> {
  const persona = loadPersona(personaName);
  const timestamp = new Date().toISOString();
  const findings: DiscoveryFinding[] = [];

  const sample = urls.slice(0, 20);

  for (const url of sample) {
    const screenshots = getScreenshotsForUrl(url);
    if (screenshots.length === 0) continue;

    const content: Anthropic.MessageParam['content'] = [
      {
        type: 'text',
        text: `You are analyzing the following page for bugs relevant to your persona.\n\nPage URL: ${url}\n\nReview the screenshot(s) and return a JSON array of findings. Each finding must include ALL of: url, screenshot (use the first screenshot path), quotedElement, claim, persona, severity (critical/high/medium/low), bugClass (revenue/a11y/network/visual/seo/content/console/lighthouse), ruleId (discovery:<slug>).\n\nIf you find no issues, return an empty array []. Return JSON only.`,
      },
    ];

    for (const shot of screenshots.slice(0, 2)) {
      const imgData = readFileSync(shot).toString('base64');
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: imgData },
      });
    }

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: persona,
        messages: [{ role: 'user', content }],
      });

      const text = (response.content[0] as { type: 'text'; text: string }).text;
      const parsed = JSON.parse(text) as Partial<DiscoveryFinding>[];

      for (const raw of parsed) {
        const candidate = { ...raw, persona: personaName, timestamp };
        const check = enforceEvidence(candidate);
        if (!check.valid) {
          console.warn(`  ⚠️  ${personaName} finding rejected (${check.reason}): ${url}`);
          continue;
        }
        findings.push(candidate as DiscoveryFinding);
      }
    } catch (err) {
      console.warn(`  ⚠️  ${personaName} agent error on ${url}:`, err instanceof Error ? err.message : err);
    }
  }

  return findings;
}

async function main(): Promise<void> {
  if (!existsSync(URL_LIST_PATH)) {
    console.error('output/url-list.json not found. Run npm run test:crawl first.');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — skipping discovery pass. Writing empty discoveries.jsonl.');
    writeFileSync(OUTPUT_PATH, '');
    return;
  }

  const client = new Anthropic({ apiKey });
  const urlList = JSON.parse(readFileSync(URL_LIST_PATH, 'utf8')) as UrlList;
  const allUrls = Object.values(urlList).flat();

  console.log(`Running ${PERSONAS.length} persona agents against ${allUrls.length} URLs...`);

  const results = await Promise.allSettled(
    PERSONAS.map(async (p) => {
      console.log(`  → ${p} starting...`);
      const findings = await runPersonaAgent(client, p, allUrls);
      console.log(`  ✅ ${p} found ${findings.length} issues`);
      return findings;
    }),
  );

  const allFindings: DiscoveryFinding[] = results
    .filter((r): r is PromiseFulfilledResult<DiscoveryFinding[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  writeFileSync(OUTPUT_PATH, allFindings.map((f) => JSON.stringify(f)).join('\n') + '\n');
  console.log(`✅ Discovery complete: ${allFindings.length} findings written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Discovery pass failed:', err);
  process.exit(1);
});
