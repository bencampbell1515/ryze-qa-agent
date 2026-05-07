import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import type { ScoredBug } from '../src/types.js';

export function fallbackCategory(ruleId: string): string {
  if (ruleId.startsWith('revenue:')) return 'Revenue & Checkout';
  if (ruleId.startsWith('axe:')) return 'Accessibility';
  if (ruleId === 'network:404') return 'Broken Links';
  if (ruleId.startsWith('seo:')) return 'SEO Tags';
  if (ruleId.startsWith('content:')) return 'Content Quality';
  return 'Other';
}

export function buildCategoryPrompt(
  findings: { fingerprint: string; ruleId: string; description: string }[],
): string {
  return `You are categorizing QA findings for an e-commerce site audit report.
Assign each finding a short category label (2–4 words) describing the type of problem.
Use consistent labels across similar findings. Be specific — "Sale Pricing" not "Content Issues".
Return JSON only: { "<fingerprint>": "<category>", ... }

Findings:
${JSON.stringify(findings, null, 2)}`;
}

export async function assignCategories(
  client: Anthropic,
  bugs: ScoredBug[],
): Promise<ScoredBug[]> {
  const findings = bugs.map((b) => ({
    fingerprint: b.fingerprint,
    ruleId: b.ruleId,
    description: b.description.slice(0, 120),
  }));

  const categoryMap = new Map<string, string>();

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildCategoryPrompt(findings) }],
    });
    const text = (response.content[0] as Anthropic.TextBlock).text.trim();
    const parsed = JSON.parse(text) as Record<string, string>;
    for (const [fp, cat] of Object.entries(parsed)) {
      categoryMap.set(fp, cat);
    }
  } catch {
    // fallback applied below
  }

  return bugs.map((bug) => ({
    ...bug,
    category: categoryMap.get(bug.fingerprint) ?? fallbackCategory(bug.ruleId),
  }));
}
