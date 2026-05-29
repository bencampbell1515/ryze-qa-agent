import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';
import { captureBugCrop } from '../../src/crops/bug-crop.js';
import { emitBug, type DualWriteContext } from './_emit.js';

/**
 * Walks the DOM for all <a target="_blank"> elements and flags those missing
 * rel="noopener". Reverse-tabnabbing risk: an opener page can be back-navigated
 * by the new tab via window.opener unless noopener is present.
 *
 * Rule ID: security:link-noopener-missing
 * Severity: medium (security smell, not a functional breakage)
 *
 * Only visible links are flagged (display/visibility/opacity checks).
 * De-duplicates by href so the same external URL is reported only once per page.
 */
export async function runExternalLinksCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
  ctx?: DualWriteContext,
): Promise<void> {
  const url = page.url();

  type Hit = {
    href: string;
    missingNoreferrer: boolean;
    selectorPath: string;
    outerHTML: string;
    /** Sequence tagged onto the live element via data-ryze-crop, for cropping. */
    cropId: number;
  };

  const hits = (await page.evaluate(`
    (function () {
      var ANCESTOR_HOPS = 10;

      function pathOf(el) {
        var parts = [];
        var cur = el;
        while (cur && cur.nodeType === 1 && parts.length < 6) {
          var tag = cur.tagName.toLowerCase();
          if (cur.id) { parts.unshift(tag + '#' + cur.id); break; }
          var cls = (cur.className && typeof cur.className === 'string')
            ? cur.className.split(' ').filter(Boolean).slice(0, 2).join('.')
            : '';
          parts.unshift(tag + (cls ? '.' + cls : ''));
          cur = cur.parentElement;
        }
        return parts.join(' > ');
      }

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
        // Use a threshold of >= 1 to catch tiny icon links (unlike image.ts's 8px threshold)
        return r.width >= 1 && r.height >= 1;
      }

      function hasToken(relAttr, token) {
        if (!relAttr) return false;
        var tokens = relAttr.toLowerCase().split(/\\s+/);
        return tokens.indexOf(token) !== -1;
      }

      var anchors = document.querySelectorAll('a[target="_blank"]');
      var seen = new Set();
      var out = [];

      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var href = a.getAttribute('href');

        // Skip empty, missing, fragment-only, or javascript: hrefs
        if (!href || href === '' || href.charAt(0) === '#' || href.toLowerCase().indexOf('javascript:') === 0) continue;

        // Skip duplicates (same href already reported for this page)
        if (seen.has(href)) continue;

        // Only flag visible links
        if (!isVisible(a)) continue;

        var rel = a.getAttribute('rel') || '';
        if (!hasToken(rel, 'noopener')) {
          seen.add(href);
          var cid = out.length;
          a.setAttribute('data-ryze-crop', String(cid));
          out.push({
            href: href,
            missingNoreferrer: !hasToken(rel, 'noreferrer'),
            selectorPath: pathOf(a),
            outerHTML: a.outerHTML.slice(0, 300),
            cropId: cid,
          });
        }
      }

      return out;
    })()
  `)) as Hit[];

  for (const hit of hits) {
    const suffix = hit.missingNoreferrer ? ' (also missing noreferrer)' : '';
    const elementScreenshot =
      (await captureBugCrop(
        page,
        { kind: 'locator', locator: page.locator(`[data-ryze-crop="${hit.cropId}"]`) },
        { url, ruleId: 'security:link-noopener-missing', viewport, seq: hit.cropId },
      )) ?? undefined;
    emitBug(bugs, ctx, {
      ruleId: 'security:link-noopener-missing',
      severity: 'medium',
      bugClass: 'content',
      message: `<a target="_blank"> missing rel="noopener" (href: ${hit.href})${suffix}`,
      url,
      viewport,
      selector: hit.selectorPath,
      outerHTMLSnippet: hit.outerHTML,
      elementScreenshot,
    }, { title: 'External link missing rel="noopener"' });
  }
}
