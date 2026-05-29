import { test, expect, chromium } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { TEMPLATES, getTemplate } from '../../src/visual-regression/templates.js';

test.describe('visual-regression: TEMPLATES', () => {
  test('has no duplicate template IDs', () => {
    const ids = TEMPLATES.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('every template has at least one viewport', () => {
    for (const t of TEMPLATES) {
      expect(t.viewports.length, `template "${t.id}" must declare a viewport`).toBeGreaterThan(0);
    }
  });

  test('every viewport value is one of desktop/tablet/mobile', () => {
    const allowed = new Set(['desktop', 'tablet', 'mobile']);
    for (const t of TEMPLATES) {
      for (const v of t.viewports) {
        expect(allowed.has(v), `template "${t.id}" has bad viewport "${v}"`).toBe(true);
      }
    }
  });

  test('every representativeUrl is an https RYZE URL', () => {
    for (const t of TEMPLATES) {
      const u = new URL(t.representativeUrl);
      expect(u.protocol).toBe('https:');
      expect(u.hostname.endsWith('ryzesuperfoods.com')).toBe(true);
    }
  });

  test('getTemplate resolves known IDs and returns undefined for unknown', () => {
    expect(getTemplate('homepage')?.id).toBe('homepage');
    expect(getTemplate('does-not-exist')).toBeUndefined();
  });

  test('all maskSelectors are valid CSS selector syntax', async () => {
    // Ground-truth validation: a real browser engine parses each selector.
    // An invalid selector throws a SyntaxError; a valid-but-unmatched one
    // returns null. We only care that it parses.
    const browser: Browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage();
      for (const t of TEMPLATES) {
        for (const sel of t.maskSelectors) {
          const ok = await page.evaluate((s) => {
            try {
              document.querySelector(s);
              return true;
            } catch {
              return false;
            }
          }, sel);
          expect(ok, `invalid CSS selector in "${t.id}": ${sel}`).toBe(true);
        }
      }
    } finally {
      await browser.close();
    }
  });
});
