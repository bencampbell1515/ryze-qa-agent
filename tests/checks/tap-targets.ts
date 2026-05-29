import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';
import { captureBugCrop } from '../../src/crops/bug-crop.js';
import { emitBug, type DualWriteContext } from './_emit.js';

/**
 * Checks that interactive elements on mobile have a tap target at least 32×32px.
 * Apple HIG recommends 44×44 (humans); we flag at <32 as an unambiguous violation.
 *
 * ONLY runs on the 'mobile' viewport. Returns immediately for desktop/tablet.
 *
 * Clickable element set: <a>, <button>, [role="button"],
 *   <input type="checkbox">, <input type="radio">
 *
 * Conservative ancestor-hoist rule: if any ancestor within 3 hops has a
 * bounding box >= 32×32 AND is itself a link/button or has cursor:pointer,
 * treat the ancestor as the tap area and skip the child. This prevents noisy
 * nav-link false positives where the <li> or <a> wrapper is the real target.
 *
 * Rule ID: content:tap-target-too-small
 * Severity: medium
 */
export async function runTapTargetsCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
  ctx?: DualWriteContext,
): Promise<void> {
  if (viewport !== 'mobile') return;

  const url = page.url();

  type Hit = {
    selectorPath: string;
    outerHTML: string;
    width: number;
    height: number;
    /** Sequence tagged onto the live element via data-ryze-crop, for cropping. */
    cropId: number;
  };

  const hits = (await page.evaluate(`
    (function () {
      var MIN_TAP = 32;
      var ANCESTOR_HOPS_VISIBILITY = 10;
      var ANCESTOR_HOPS_PARENT_CHECK = 3;

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
        while (cur && hops++ < ANCESTOR_HOPS_VISIBILITY) {
          var ps = window.getComputedStyle(cur);
          if (parseFloat(ps.opacity) === 0) return false;
          if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') return false;
          cur = cur.parentElement;
        }
        var r = el.getBoundingClientRect();
        // Visible = at least 1×1 in bounding box (threshold for "found")
        return r.width >= 1 && r.height >= 1;
      }

      function isAncestorTapTarget(el) {
        // Walk up to 3 ancestors; if any is a natural/ARIA tap target with
        // adequate size, treat the child as covered and skip it.
        var cur = el.parentElement;
        var hops = 0;
        while (cur && hops++ < ANCESTOR_HOPS_PARENT_CHECK) {
          var tag = cur.tagName.toLowerCase();
          var role = (cur.getAttribute('role') || '').toLowerCase();
          var cs = window.getComputedStyle(cur);
          var isTapEl = tag === 'a' || tag === 'button' || role === 'button';
          var hasPointer = cs.cursor === 'pointer';
          if (isTapEl || hasPointer) {
            var r = cur.getBoundingClientRect();
            if (r.width >= MIN_TAP && r.height >= MIN_TAP) return true;
          }
          cur = cur.parentElement;
        }
        return false;
      }

      // Build selector for all clickable elements
      var selector = 'a, button, [role="button"], input[type="checkbox"], input[type="radio"]';
      var elements = document.querySelectorAll(selector);
      var seen = new Set();
      var out = [];

      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        var tag = el.tagName.toLowerCase();

        // Skip decorative / no-op anchors
        if (tag === 'a') {
          var href = el.getAttribute('href');
          if (href === '#' || href === '' || href === null) continue;
        }

        if (!isVisible(el)) continue;

        var r = el.getBoundingClientRect();
        var w = Math.round(r.width);
        var h = Math.round(r.height);

        // Only interested in elements that are actually too small
        if (w >= MIN_TAP && h >= MIN_TAP) continue;

        // Check if an ancestor is the real tap target (conservative hoist)
        if (isAncestorTapTarget(el)) continue;

        var sp = pathOf(el);
        if (seen.has(sp)) continue;
        seen.add(sp);

        var cid = out.length;
        el.setAttribute('data-ryze-crop', String(cid));
        out.push({
          selectorPath: sp,
          outerHTML: el.outerHTML.slice(0, 300),
          width: w,
          height: h,
          cropId: cid,
        });
      }

      return out;
    })()
  `)) as Hit[];

  for (const hit of hits) {
    const elementScreenshot =
      (await captureBugCrop(
        page,
        { kind: 'locator', locator: page.locator(`[data-ryze-crop="${hit.cropId}"]`) },
        { url, ruleId: 'content:tap-target-too-small', viewport, seq: hit.cropId },
      )) ?? undefined;
    emitBug(bugs, ctx, {
      ruleId: 'content:tap-target-too-small',
      severity: 'medium',
      bugClass: 'content',
      message: `Clickable element renders ${hit.width}×${hit.height}px on mobile (Apple HIG recommends ≥44×44; flagging <32×32)`,
      url,
      viewport,
      selector: hit.selectorPath,
      outerHTMLSnippet: hit.outerHTML,
      elementScreenshot,
    }, { title: 'Tap target too small on mobile' });
  }
}
