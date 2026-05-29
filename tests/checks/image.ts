import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';
import { captureBugCrop } from '../../src/crops/bug-crop.js';
import { emitBug, type DualWriteContext } from './_emit.js';

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
  ctx?: DualWriteContext,
): Promise<void> {
  const url = page.url();

  type Hit = {
    kind: 'empty-src' | 'zero-natural' | 'broken-picture-template';
    selectorPath: string;
    outerHTML: string;
    box: { x: number; y: number; w: number; h: number };
    extra?: string;
    /** Sequence tagged onto the live element via data-ryze-crop, for cropping. */
    cropId: number;
  };

  // Two-pass collection to suppress race-condition false positives on `zero-natural`:
  // some <img> tags briefly report `complete=true && naturalWidth=0` while a slow
  // CDN response is in-flight. Wait 1500ms after the first scan and re-confirm
  // each candidate before emitting it. Verified empirically (2026-05-12) that
  // `starter-kit-featured` images flagged as `naturalWidth=0` actually finish
  // loading with `naturalWidth=1500+` ~1s later.
  const hits = (await page.evaluate(`
    (async function () {
      var BROKEN_PICTURE_RE = /cdn\\/shop\\/files\\/\\?v=/;
      var MIN_BOX = 8; // ignore 1px tracking pixels and decorative shims
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

      // Visibility check walks ancestors for opacity:0 and aria-hidden=true since
      // neither propagates as a computed style on the child. display:none and
      // visibility:hidden on ancestors are already caught (zero bbox or inherited
      // computed visibility, respectively).
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

      // PASS 1 — collect candidates, keeping live element references for re-check
      var candidates = []; // { kind, el, selectorPath, outerHTML, box, extra }
      var imgs = document.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!isVisible(img)) continue;
        var srcAttr = img.getAttribute('src');
        var r = img.getBoundingClientRect();
        var common = {
          el: img,
          selectorPath: pathOf(img),
          outerHTML: img.outerHTML.slice(0, 300),
          box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
        if (srcAttr === '' || srcAttr === null) {
          candidates.push(Object.assign({ kind: 'empty-src' }, common));
          continue;
        }
        if (img.complete && img.naturalWidth === 0) {
          candidates.push(Object.assign({ kind: 'zero-natural', extra: 'src=' + srcAttr.slice(0, 200) }, common));
        }
      }

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
        candidates.push({
          kind: 'broken-picture-template',
          el: pic,
          selectorPath: pathOf(pic),
          outerHTML: pic.outerHTML.slice(0, 400),
          box: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
          extra: 'srcset=' + srcset.slice(0, 200),
        });
      }

      // PASS 2 — re-check zero-natural after a delay; drop if image now reports
      // a positive naturalWidth (slow CDN response settled).
      await new Promise(function (resolve) { setTimeout(resolve, 1500); });

      // SCOPE: only flag bugs within ~1.5x viewport height of the top of the
      // page. Latent DOM defects buried far below the fold (e.g., y > 4000px
      // on a 900px viewport) aren't part of the shopper UX and should not
      // dominate the report. Real first-impression breakage is always inside
      // this range.
      var VIEWPORT_CUTOFF = window.innerHeight * 1.5;

      var out = [];
      for (var k = 0; k < candidates.length; k++) {
        var c = candidates[k];
        if (c.kind === 'zero-natural') {
          var i2 = c.el;
          if (!(i2.complete && i2.naturalWidth === 0)) continue; // recovered → suppress
        }
        // Re-read live bounding box after the 1500ms wait — layout may have shifted.
        var freshRect = c.el.getBoundingClientRect();
        var topY = freshRect.top + window.scrollY;
        if (topY > VIEWPORT_CUTOFF) continue; // below the fold → not a visible UX bug
        // Tag the live element so the Node side can resolve a locator and crop it,
        // then strip the element reference before returning across the bridge.
        var cid = out.length;
        c.el.setAttribute('data-ryze-crop', String(cid));
        out.push({
          kind: c.kind, selectorPath: c.selectorPath, outerHTML: c.outerHTML,
          box: c.box, extra: c.extra, cropId: cid,
        });
      }
      return out;
    })()
  `)) as Hit[];

  for (const hit of hits) {
    const ruleId =
      hit.kind === 'empty-src' ? 'content:empty-image-src'
      : hit.kind === 'zero-natural' ? 'content:broken-image'
      : 'content:broken-picture-template';

    // Crop the flagged element (tagged with data-ryze-crop in the evaluate).
    // captureBugCrop never throws — returns null if the element can't be cropped.
    const elementScreenshot =
      (await captureBugCrop(
        page,
        { kind: 'locator', locator: page.locator(`[data-ryze-crop="${hit.cropId}"]`) },
        { url, ruleId, viewport, seq: hit.cropId },
      )) ?? undefined;

    if (hit.kind === 'empty-src') {
      emitBug(bugs, ctx, {
        ruleId,
        severity: 'high',
        bugClass: 'content',
        message: `Visible <img> with empty src renders as a blank ${hit.box.w}×${hit.box.h} box (no broken-image icon shown). Likely a template binding to a null/missing field.`,
        url,
        viewport,
        selector: hit.selectorPath,
        outerHTMLSnippet: hit.outerHTML,
        elementScreenshot,
      }, { title: 'Image with empty src renders blank' });
    } else if (hit.kind === 'zero-natural') {
      emitBug(bugs, ctx, {
        ruleId,
        severity: 'high',
        bugClass: 'content',
        message: `Visible <img> loaded but renders empty (naturalWidth=0) at ${hit.box.w}×${hit.box.h}. ${hit.extra ?? ''}`,
        url,
        viewport,
        selector: hit.selectorPath,
        outerHTMLSnippet: hit.outerHTML,
        elementScreenshot,
      }, { title: 'Image loaded but renders empty' });
    } else if (hit.kind === 'broken-picture-template') {
      emitBug(bugs, ctx, {
        ruleId,
        severity: 'high',
        bugClass: 'content',
        message: `Visible <picture> with empty filename in srcset (cdn/shop/files/?v=…). Replo/page-builder block bound to a missing metafield. ${hit.extra ?? ''}`,
        url,
        viewport,
        selector: hit.selectorPath,
        outerHTMLSnippet: hit.outerHTML,
        elementScreenshot,
      }, { title: 'Picture srcset has empty filename' });
    }
  }
}
