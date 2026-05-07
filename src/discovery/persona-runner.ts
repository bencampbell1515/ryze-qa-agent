// src/discovery/persona-runner.ts
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runSession } from './agent-loop.js';
import type { DiscoveryFinding, UrlList } from '../types.js';

const SESSION_BUDGET = 7;
const PERSONAS_DIR = join(process.cwd(), 'personas');

const PERSONA_URL_TYPES: Record<string, Array<keyof UrlList>> = {
  'revenue-hawk':          ['product', 'cart', 'collection'],
  'skeptical-first-timer': ['home', 'product', 'blog'],
  'brand-purist':          ['home', 'product', 'collection', 'page', 'blog', 'policy'],
  'forensic-technician':   ['product', 'page', 'policy'],
};

const PERSONA_VIEWPORT: Record<string, { width: number; height: number; isMobile: boolean }> = {
  'revenue-hawk':          { width: 1440, height: 900, isMobile: false },
  'skeptical-first-timer': { width: 390,  height: 844, isMobile: true  },
  'brand-purist':          { width: 1440, height: 900, isMobile: false },
  'forensic-technician':   { width: 1440, height: 900, isMobile: false },
};

const PERSONA_MODEL: Record<string, string> = {
  'revenue-hawk':          'claude-haiku-4-5-20251001',
  'skeptical-first-timer': 'claude-haiku-4-5-20251001',
  'brand-purist':          'claude-haiku-4-5-20251001',
  'forensic-technician':   'claude-haiku-4-5-20251001',
};

// Hard cap: prior-findings injected into each session's first user message.
// Keeps cross-session summary well under the 200k token limit.
const MAX_SUMMARY_CHARS = 4_000;

function buildFindingsSummary(discoveriesPath: string, personaName: string): string {
  if (!existsSync(discoveriesPath)) return '';
  const lines = readFileSync(discoveriesPath, 'utf8').split('\n').filter(Boolean);
  const findings = lines
    .map(l => JSON.parse(l) as DiscoveryFinding)
    .filter(f => f.persona === personaName);
  if (findings.length === 0) return '';
  const full = findings.map(f => `[${f.ruleId}] ${f.url} — ${f.claim}`).join('\n');
  if (full.length <= MAX_SUMMARY_CHARS) return full;
  // Keep the most recent findings (tail) so the persona doesn't re-report them
  const truncated = full.slice(-MAX_SUMMARY_CHARS);
  const firstNewline = truncated.indexOf('\n');
  return '...(earlier findings omitted)\n' + (firstNewline >= 0 ? truncated.slice(firstNewline + 1) : truncated);
}

export async function runPersona(opts: {
  client: Anthropic;
  personaName: string;
  urlList: UrlList;
  screenshotsDir: string;
  discoveriesPath: string;
}): Promise<void> {
  const { client, personaName, urlList, screenshotsDir, discoveriesPath } = opts;

  const personaPath = join(PERSONAS_DIR, `${personaName}.md`);
  if (!existsSync(personaPath)) {
    console.warn(`  ⚠️  Persona file not found: ${personaPath} — skipping`);
    return;
  }
  const systemPrompt = readFileSync(personaPath, 'utf8');

  const urlTypes = PERSONA_URL_TYPES[personaName] ?? (Object.keys(urlList) as Array<keyof UrlList>);
  const allUrls = urlTypes.flatMap(type => urlList[type] ?? []);

  const vp = PERSONA_VIEWPORT[personaName] ?? { width: 1440, height: 900, isMobile: false };

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    userAgent: 'RyzeQABot/0.1 (+pm@ryze.example)',
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
  });
  const page = await context.newPage();

  const visited = new Set<string>();
  let sessionNum = 0;

  try {
    while (true) {
      const unvisited = allUrls.filter(u => !visited.has(u));
      if (unvisited.length === 0) break;

      sessionNum++;
      console.log(`  [${personaName}] Session ${sessionNum}: ${unvisited.length} URLs remaining`);

      const summary = buildFindingsSummary(discoveriesPath, personaName);

      const result = await runSession({
        client,
        page,
        personaSystemPrompt: systemPrompt,
        personaName,
        targetUrls: unvisited,
        previousFindingsSummary: summary,
        screenshotsDir,
        discoveriesPath,
        sessionBudget: SESSION_BUDGET,
        model: PERSONA_MODEL[personaName] ?? 'claude-sonnet-4-6',
      });

      for (const url of result.visitedUrls) visited.add(url);

      console.log(
        `  [${personaName}] Session ${sessionNum}: visited ${result.visitedUrls.length} URLs, ${result.toolCallCount} tool calls`
      );

      if (result.visitedUrls.length === 0) {
        console.warn(`  [${personaName}] Session ${sessionNum} visited 0 URLs — stopping to avoid infinite loop`);
        break;
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`  ✅ [${personaName}] Complete after ${sessionNum} sessions`);
}
