import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

const EXCLUDED_SELECTORS = [
  'iframe[src*="klaviyo"]',
  '#gorgias-chat-container',
  '#fb-root',
  '[id*="tiktok"]',
];

export async function runA11yCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);

  for (const sel of EXCLUDED_SELECTORS) {
    builder = builder.exclude(sel);
  }

  const results = await builder.analyze();

  for (const violation of results.violations) {
    const impact = violation.impact ?? 'minor';
    const severity =
      impact === 'critical' || impact === 'serious'
        ? ('high' as const)
        : ('medium' as const);

    for (const node of violation.nodes) {
      bugs.add({
        ruleId: `axe:${violation.id}`,
        severity,
        bugClass: 'a11y',
        message: `${violation.description} — ${node.failureSummary ?? ''}`,
        url: page.url(),
        viewport,
        selector: node.target.join(', '),
        helpUrl: violation.helpUrl,
        axeNodes: node.target.map(String),
      });
    }
  }
}
