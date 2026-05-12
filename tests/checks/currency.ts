import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

/**
 * Detects mixed currency formats on a page.
 *
 * Walks the DOM for visible text nodes containing USD price tokens ($\d...).
 * Classifies each token as:
 *   - "canonical"  — $1,234.56 or $30.00 (comma-grouped, two decimal places)
 *   - "loose"      — $30 or $30.5 (no commas, optional 1-2 decimals)
 *   - "other"      — any other $+digit pattern
 *
 * Flags the page when both "canonical" and "loose" appear, or when any "other"
 * token is present — mixed formatting creates an inconsistent user experience.
 *
 * Rule ID : content:currency-format-inconsistent
 * Severity : medium
 */
export async function runCurrencyCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  const url = page.url();

  type PriceToken = {
    text: string;
    kind: 'canonical' | 'loose' | 'other';
  };

  const tokens = (await page.evaluate(`
    (function () {
      var PRICE_RE = /\\$\\d[\\d,\\.]*\\d?/g;
      var CANONICAL_RE = /^\\$\\d{1,3}(,\\d{3})*\\.\\d{2}$/;
      var LOOSE_RE = /^\\$\\d+(\\.\\d{1,2})?$/;
      var MIN_BOX = 8;
      var ANCESTOR_HOPS = 10;

      function isVisible(el) {
        var s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
        var cur = el.parentElement;
        var hops = 0;
        while (cur && hops++ < ANCESTOR_HOPS) {
          var ps = window.getComputedStyle(cur);
          if (parseFloat(ps.opacity) === 0) return false;
          if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') return false;
          cur = cur.parentElement;
        }
        var r = el.getBoundingClientRect();
        return r.width >= MIN_BOX && r.height >= MIN_BOX;
      }

      function classify(token) {
        if (CANONICAL_RE.test(token)) return 'canonical';
        if (LOOSE_RE.test(token)) return 'loose';
        return 'other';
      }

      var results = [];
      var seen = new Set();

      // Walk all text nodes in the document
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        var parent = node.parentElement;
        if (!parent) continue;
        if (!isVisible(parent)) continue;
        var text = node.textContent || '';
        var matches = text.match(PRICE_RE);
        if (!matches) continue;
        for (var i = 0; i < matches.length; i++) {
          var token = matches[i];
          if (seen.has(token)) continue;
          seen.add(token);
          results.push({ text: token, kind: classify(token) });
        }
      }
      return results;
    })()
  `)) as PriceToken[];

  if (tokens.length < 2) return; // need at least 2 price tokens to compare formats

  const hasCanonical = tokens.some((t) => t.kind === 'canonical');
  const hasLoose = tokens.some((t) => t.kind === 'loose');
  const hasOther = tokens.some((t) => t.kind === 'other');

  if ((hasCanonical && hasLoose) || hasOther) {
    const sample = tokens.slice(0, 3).map((t) => t.text).join(', ');
    bugs.add({
      ruleId: 'content:currency-format-inconsistent',
      severity: 'medium',
      bugClass: 'content',
      message: `Mixed currency formats on page: ${sample}`,
      url,
      viewport,
    });
  }
}
