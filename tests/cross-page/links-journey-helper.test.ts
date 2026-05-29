import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  checkLinksInContainer,
  type PageLike,
} from '../../src/cross-page/links-journey-helper.js';
import type { LycheeExecutor } from '../../src/cross-page/links.js';

const RUN_ID = 'testrun';
const PAGE_URL = 'https://www.ryzesuperfoods.com/checkout';
const BROKEN = 'https://www.ryzesuperfoods.com/policies/privacy-policy';

/** A mock Page exposing a container with 3 links (2 ok, 1 broken). */
function mockPage(links: string[]): PageLike {
  return {
    url: () => PAGE_URL,
    async $$eval<R>(_selector: string, fn: (els: Element[]) => R): Promise<R> {
      // Stand in for the in-page evaluation: return the anchor hrefs directly.
      const fakeEls = links.map((href) => ({ href }) as unknown as Element);
      return fn(fakeEls);
    },
  };
}

/** lychee stub: one of the three links is broken. */
const mockExec: LycheeExecutor = async (_b, args) => {
  if (args.includes('--version')) return { stdout: 'lychee 0.15.1', stderr: '', code: 0 };
  const json = {
    total: 3,
    successful: 2,
    failures: 1,
    fail_map: {
      'tmp-journey.html': [{ url: BROKEN, status: { code: 404, text: 'Not Found' } }],
    },
  };
  return { stdout: JSON.stringify(json), stderr: '', code: 2 };
};

test('journey helper: container with 3 links (2 ok, 1 broken) yields 1 Finding tagged with context', async () => {
  const page = mockPage([
    'https://www.ryzesuperfoods.com/products/coffee',
    'https://www.ryzesuperfoods.com/pages/about',
    BROKEN,
  ]);

  const findings = await checkLinksInContainer(
    page,
    '.checkout-disclaimer',
    RUN_ID,
    'checkout-disclaimer',
    mockExec,
  );

  expect(findings).toHaveLength(1);
  const f = findings[0]!;
  expect(f.meta?.context).toBe('checkout-disclaimer');
  expect(f.ruleId).toBe('cross-page:broken-link');
  // Re-anchored to the live page, not the throwaway temp file.
  expect(f.url).toBe(PAGE_URL);
  expect(f.relatedUrls).toEqual([BROKEN]);
  expect(f.severity).toBe('high'); // same host as the page → internal

  // Fingerprint is stable: derived from the real page URL, not the temp file.
  const expectedFp = createHash('sha1')
    .update(`cross-page:broken-link:${PAGE_URL}:${BROKEN}`)
    .digest('hex');
  expect(f.fingerprint).toBe(expectedFp);
});

test('journey helper: empty container yields zero Findings without invoking lychee', async () => {
  const page = mockPage([]);
  let called = false;
  const trackingExec: LycheeExecutor = async (...args) => {
    called = true;
    return mockExec(...args);
  };
  const findings = await checkLinksInContainer(
    page,
    '.empty',
    RUN_ID,
    'empty-context',
    trackingExec,
  );
  expect(findings).toHaveLength(0);
  expect(called).toBe(false);
});
