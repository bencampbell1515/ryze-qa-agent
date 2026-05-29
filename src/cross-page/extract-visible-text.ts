/**
 * Helper for the language check: pull visible, block-level text off a live page
 * as newline-separated blocks (one per <p>, <h1>-<h6>, list item, or table
 * cell), which is exactly the tokenisation {@link checkPageLanguage} expects.
 *
 * The brief (worktree-C) lets the caller decide what counts as a block; this is
 * the default extractor for when no upstream extraction stage exists yet. It is
 * deliberately separate from `language.ts` so the core check stays Playwright-
 * free and trivially unit-testable with fixture strings.
 *
 * Implementation note (see tests/CLAUDE.md): the DOM walk is passed to
 * `page.evaluate` in STRING form, not as an arrow function. tsx-transpiled
 * closures inject a `__name` helper that doesn't exist in the browser context
 * (`ReferenceError: __name is not defined`). String form sidesteps that.
 */

import type { Page } from '@playwright/test';

const EXTRACT_FN = `(function () {
  var SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, td';
  var nodes = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));
  var out = [];
  var seen = Object.create(null);
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    // Skip nested block containers: a <li> wrapping <p> would double-count.
    if (el.querySelector && el.querySelector(SELECTOR)) continue;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    if (seen[text]) continue;
    seen[text] = true;
    out.push(text);
  }
  return out.join('\\n');
})()`;

/** Returns visible block-level text as newline-separated blocks. */
export async function extractVisibleText(page: Page): Promise<string> {
  return page.evaluate(EXTRACT_FN);
}

export default extractVisibleText;
