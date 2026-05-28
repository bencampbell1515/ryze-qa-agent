import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

/**
 * Re-attach viewport-aware console listeners.
 * Call before page.goto() for each viewport context.
 *
 * **CURRENTLY UNUSED** — `crawl.spec.ts` deliberately does not call this. Every
 * `console:error` and `js:pageerror` captured in headless Chrome is third-party
 * noise (Popper.js, analytics, jQuery-via-blocked-GTM), and these were producing
 * ~13k entries per run that then dominated validate.ts's Haiku queue for 20–40
 * minutes. The function is preserved here in case we ever run audits in a
 * trusted browser context (headed with extensions disabled, no blocked GTM,
 * etc.) where these signals would be real. Until then, do not call it.
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
