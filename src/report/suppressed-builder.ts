import { escapeHtml, urlListHtml } from './html-builder.js';
import type { BugRecord } from '../types.js';

export type SuppressedMeta = { crawlDate: string };

export async function buildSuppressedHtml(
  records: BugRecord[],
  meta: SuppressedMeta,
): Promise<string> {
  const header = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Suppressed Bugs — ${escapeHtml(meta.crawlDate)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
  .intro { color: #555; margin-bottom: 2rem; line-height: 1.5; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; background: #fafafa; }
  .rule { font-family: monospace; font-size: 0.85rem; color: #666; background: #eee; padding: 2px 6px; border-radius: 3px; }
  .reason { margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: #fff8dc; border-left: 3px solid #d4af37; font-size: 0.9rem; }
  .reason-label { font-weight: 600; color: #876c00; }
  .urls { margin-top: 0.5rem; font-size: 0.85rem; }
  .urls a { color: #1a73e8; text-decoration: none; }
  .empty { color: #777; padding: 2rem; text-align: center; }
</style></head><body>
<h1>Suppressed Bugs — ${escapeHtml(meta.crawlDate)}</h1>
<p class="intro">
  These are real DOM-level defects the visual gate suppressed because the LLM judged that a shopper wouldn't notice them.
  Spot-check anything that looks wrong-suppressed and adjust the gate's prompt or scope if needed.
  Bugs in the main report were either judged visible/uncertain by the LLM, or were never gated (e.g., critical revenue/functional bugs).
</p>`;

  if (records.length === 0) {
    return header + `<p class="empty">No suppressed bugs in this run.</p></body></html>`;
  }

  const cards = records.map((r) => `
<div class="card">
  <div><strong>${escapeHtml(r.title)}</strong> <span class="rule">${escapeHtml(r.ruleId)}</span></div>
  <div>${escapeHtml(r.description)}</div>
  <div class="reason"><span class="reason-label">LLM reason:</span> ${escapeHtml(r.verdictReason ?? '(no reason recorded)')}</div>
  <div class="urls">Affected (${r.urls.length}): ${urlListHtml(r.urls)}</div>
</div>`).join('\n');

  return header + cards + '</body></html>';
}
