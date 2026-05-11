import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';

/**
 * Detects images that render as nothing without firing a network error:
 *
 *  1. `<img src="">` — empty string is silently ignored by the browser
 *     (no broken-image icon, no 404). Treated as a no-op per HTML spec.
 *  2. `<img>` that finished loading but has naturalWidth === 0 — the URL
 *     was fetched and the response was invalid or zero-byte.
 *  3. `<picture>` whose `<source>` srcset references the broken Replo
 *     template pattern `cdn/shop/files/?v=…&width=…` (no filename).
 *
 * Only flags VISIBLE elements (display/visibility/opacity > 0 and box > 0×0)
 * so hidden modal slots and off-screen carousels stay silent.
 *
 * `network:404` already covers (3) for the fetched-variant URL. This check
 * exists to surface (1) and (2), which currently slip through entirely —
 * an `<img src="">` never generates a network event for the bot to record.
 */
export async function runImageCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): Promise<void> {
  const url = page.url();

  type Hit = {
    kind: 'empty-src' | 'zero-natural' | 'broken-picture-template';
    selectorPath: string;
    outerHTML: string;
    box: { x: number; y: number; w: number; h: number };
    extra?: string;
  };

  const hits = (await page.evaluate(`
    (function () {
      var BROKEN_PICTURE_RE = /cdn\\/shop\\/files\\/\\?v=/;
      var MIN_BOX = 8; // ignore 1px tracking pixels and decorative shims
      var out = [];

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
        var r = el.getBoundingClientRect();
        return r.width >= MIN_BOX && r.height >= MIN_BOX;
      }

      // (1) and (2): <img> elements
      var imgs = document.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!isVisible(img)) continue;
        var srcAttr = img.getAttribute('src');
        var r = img.getBoundingClientRect();
        var common = {
          selectorPath: pathOf(img),
          outerHTML: img.outerHTML.slice(0, 300),
          box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
        if (srcAttr === '' || srcAttr === null) {
          out.push(Object.assign({ kind: 'empty-src' }, common));
          continue;
        }
        // Image has finished loading but the response was empty / unrenderable.
        // .complete is true after either successful decode or hard failure.
        if (img.complete && img.naturalWidth === 0) {
          out.push(Object.assign({ kind: 'zero-natural', extra: 'src=' + srcAttr.slice(0, 200) }, common));
        }
      }

      // (3): broken <picture> template — Replo / page-builder emitting empty filename
      var sources = document.querySelectorAll('picture source[srcset]');
      var reportedPictures = new Set();
      for (var j = 0; j < sources.length; j++) {
        var src = sources[j];
        var srcset = src.getAttribute('srcset') || '';
        if (!BROKEN_PICTURE_RE.test(srcset)) continue;
        var pic = src.closest('picture');
        if (!pic || reportedPictures.has(pic)) continue;
        reportedPictures.add(pic);
        if (!isVisible(pic)) continue;
        var pr = pic.getBoundingClientRect();
        out.push({
          kind: 'broken-picture-template',
          selectorPath: pathOf(pic),
          outerHTML: pic.outerHTML.slice(0, 400),
          box: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
          extra: 'srcset=' + srcset.slice(0, 200),
        });
      }

      return out;
    })()
  `)) as Hit[];

  for (const hit of hits) {
    if (hit.kind === 'empty-src') {
      bugs.add({
        ruleId: 'content:empty-image-src',
        severity: 'high',
        bugClass: 'content',
        message: `Visible <img> with empty src renders as a blank ${hit.box.w}×${hit.box.h} box (no broken-image icon shown). Likely a template binding to a null/missing field.`,
        url,
        viewport,
        selector: hit.selectorPath,
        outerHTMLSnippet: hit.outerHTML,
      });
    } else if (hit.kind === 'zero-natural') {
      bugs.add({
        ruleId: 'content:broken-image',
        severity: 'high',
        bugClass: 'content',
        message: `Visible <img> loaded but renders empty (naturalWidth=0) at ${hit.box.w}×${hit.box.h}. ${hit.extra ?? ''}`,
        url,
        viewport,
        selector: hit.selectorPath,
        outerHTMLSnippet: hit.outerHTML,
      });
    } else if (hit.kind === 'broken-picture-template') {
      bugs.add({
        ruleId: 'content:broken-picture-template',
        severity: 'high',
        bugClass: 'content',
        message: `Visible <picture> with empty filename in srcset (cdn/shop/files/?v=…). Replo/page-builder block bound to a missing metafield. ${hit.extra ?? ''}`,
        url,
        viewport,
        selector: hit.selectorPath,
        outerHTMLSnippet: hit.outerHTML,
      });
    }
  }
}
