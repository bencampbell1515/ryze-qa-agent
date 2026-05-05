// scripts/validate.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import type { BugInstance, DismissedEntry } from '../src/types.js';
import { computeFingerprint } from '../src/dedupe/fingerprint.js';

const BUGS_PATH = join(process.cwd(), 'data', 'bugs.jsonl');
const DISMISSED_PATH = join(process.cwd(), 'data', 'dismissed.jsonl');
const OUTPUT_PATH = join(process.cwd(), 'data', 'validated-bugs.jsonl');
const BATCH_SIZE = 20;

function loadDismissed(): Set<string> {
  if (!existsSync(DISMISSED_PATH)) return new Set();
  return new Set(
    readFileSync(DISMISSED_PATH, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as DismissedEntry).fingerprint),
  );
}

async function validateBug(
  client: Anthropic,
  bug: BugInstance,
): Promise<{ validated: boolean; confidence: number }> {
  const content: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: `You are a QA validation agent. A Playwright test flagged the following issue on a Shopify e-commerce site. Determine whether this is a real bug or a false positive (e.g., bot-artifact, timing issue, intentional design).

Rule ID: ${bug.ruleId}
Severity: ${bug.severity}
URL: ${bug.url}
Viewport: ${bug.viewport}
Message: ${bug.message}
${bug.outerHTMLSnippet ? `HTML snippet: ${bug.outerHTMLSnippet}` : ''}

Respond with JSON only: {"validated": true/false, "confidence": 0.0-1.0, "reason": "one sentence"}`,
    },
  ];

  if (bug.elementScreenshot && existsSync(bug.elementScreenshot)) {
    const imgData = readFileSync(bug.elementScreenshot).toString('base64');
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: imgData },
    });
  }

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content }],
    });

    const text = (response.content[0] as Anthropic.TextBlock).text;
    const parsed = JSON.parse(text) as { validated: boolean; confidence: number };
    return { validated: parsed.validated, confidence: parsed.confidence };
  } catch {
    return { validated: true, confidence: 0.5 };
  }
}

async function main(): Promise<void> {
  if (!existsSync(BUGS_PATH)) {
    console.error('data/bugs.jsonl not found. Run npm run test:audit first.');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — copying bugs.jsonl with default confidence.');
    const raw = readFileSync(BUGS_PATH, 'utf8');
    writeFileSync(OUTPUT_PATH, raw);
    return;
  }

  const client = new Anthropic({ apiKey });
  const dismissed = loadDismissed();

  const lines = readFileSync(BUGS_PATH, 'utf8').split('\n').filter(Boolean);
  const bugs: BugInstance[] = lines.map((l) => JSON.parse(l) as BugInstance);

  const active = bugs.filter((b) => {
    const fp = computeFingerprint(b.ruleId, b.message, b.sectionAnchor ?? 'document', b.dHash);
    return !dismissed.has(fp);
  });

  console.log(`Validating ${active.length} findings (${bugs.length - active.length} dismissed)...`);

  const limit = pLimit(BATCH_SIZE);
  const results = await Promise.all(
    active.map((bug) =>
      limit(async () => {
        const { validated, confidence } = await validateBug(client, bug);
        return { ...bug, validated, confidence };
      }),
    ),
  );

  writeFileSync(OUTPUT_PATH, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const passCount = results.filter((r) => r.validated).length;
  console.log(`✅ Validation complete: ${passCount}/${results.length} confirmed, ${results.length - passCount} invalidated.`);
  console.log(`Written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Validation pass failed:', err);
  process.exit(1);
});
