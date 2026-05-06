import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import type { ScoredBug, Severity } from '../src/types.js';

export function SUMMARY_MODEL(severity: Severity): string {
  return severity === 'low' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
}

export function buildSummaryPrompt(bug: ScoredBug): string {
  const urls = bug.urls.slice(0, 3).join('\n');
  return `You are writing a plain-English bug summary for a non-technical stakeholder report.
Rule: ${bug.ruleId}
Description: ${bug.description}
Affected URLs:
${urls}
Write 1–2 sentences that explain what is wrong and why it matters to a customer or the business.
Be specific — reference the actual content or URL if it helps. Do not use jargon.
Respond with only the summary text, no preamble.`;
}

async function summariseOne(client: Anthropic, bug: ScoredBug): Promise<string> {
  try {
    const response = await client.messages.create({
      model: SUMMARY_MODEL(bug.severity),
      max_tokens: 150,
      messages: [{ role: 'user', content: buildSummaryPrompt(bug) }],
    });
    return (response.content[0] as Anthropic.TextBlock).text.trim();
  } catch {
    return bug.description.slice(0, 200);
  }
}

export async function generateSummaries(
  client: Anthropic,
  bugs: ScoredBug[],
): Promise<ScoredBug[]> {
  const limit = pLimit(10);
  const results = await Promise.all(
    bugs.map((bug) =>
      limit(async () => {
        const summary = await summariseOne(client, bug);
        return { ...bug, summary };
      }),
    ),
  );
  return results;
}
