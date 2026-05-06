// scripts/semantic-dedup.ts
import Anthropic from '@anthropic-ai/sdk';
import type { DiscoveryFinding } from '../src/types.js';

const MODEL = 'claude-haiku-4-5-20251001';

export async function semanticDedup(
  client: Anthropic,
  findings: DiscoveryFinding[],
): Promise<DiscoveryFinding[]> {
  if (findings.length <= 1) return findings;

  const numbered = findings
    .map((f, i) => `[${i}] ${f.ruleId} @ ${f.url}\n    ${f.claim}`)
    .join('\n');

  let raw: string;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        'You are a deduplication assistant. Identify groups of bug reports that describe the same underlying defect on the same or similar pages. Different phrasings of the same broken element = same bug. Different elements or different pages = different bugs. Respond ONLY with a JSON array. Each element is an object with "keep" (index of the best report to keep) and "discard" (array of indices to remove). If no duplicates exist, respond with [].',
      messages: [
        {
          role: 'user',
          content: `These are persona-discovered bug reports. Identify duplicates:\n\n${numbered}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    raw = textBlock?.type === 'text' ? textBlock.text.trim() : '[]';
  } catch (err) {
    console.warn('⚠️  Semantic dedup LLM call failed — skipping dedup:', (err as Error).message);
    return findings;
  }

  let groups: Array<{ keep: number; discard: number[] }>;
  try {
    // Strip markdown code fences if model wraps response
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    groups = JSON.parse(jsonStr);
  } catch {
    console.warn('⚠️  Semantic dedup response parse failed — skipping dedup. Raw:', raw.slice(0, 200));
    return findings;
  }

  const discardSet = new Set<number>();
  for (const group of groups) {
    for (const idx of group.discard) {
      if (idx >= 0 && idx < findings.length) discardSet.add(idx);
    }
  }

  const result = findings.filter((_, i) => !discardSet.has(i));
  if (discardSet.size > 0) {
    console.log(`  🔁 Semantic dedup: removed ${discardSet.size} duplicate persona finding(s), ${result.length} remain`);
  }
  return result;
}
