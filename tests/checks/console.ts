import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

/**
 * Re-attach viewport-aware console listeners.
 * Call before page.goto() for each viewport context.
 */
export function attachConsoleListeners(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): void {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    bugs.add({
      ruleId: 'console:error',
      severity: 'high',
      bugClass: 'console',
      message: msg.text(),
      url: page.url(),
      viewport,
    });
  });

  page.on('pageerror', (err) => {
    bugs.add({
      ruleId: 'js:pageerror',
      severity: 'critical',
      bugClass: 'console',
      message: err.message,
      url: page.url(),
      viewport,
    });
  });
}
