import { test, expect } from '@playwright/test';
import {
  checkCopyrightYear,
  checkBrandTerms,
  checkUrlTypos,
} from '../../src/cross-page/content-rules.js';
import type { CanonicalRecord, Finding } from '../../src/types/finding.js';

const RUN_ID = 'test-run';

function canonicalFixture(overrides: Partial<CanonicalRecord> = {}): CanonicalRecord {
  return {
    businessAddresses: ['RYZE, INC., Austin, TX'],
    supportEmail: 'hello@ryzesuperfoods.com',
    brandName: 'RYZE',
    brandVariants: ['RYZE', 'Ryze'],
    acceptableCopyrightYears: [2025, 2026],
    localePathPrefixes: { es: '/es/' },
    brandTerms: ['brandambassador', 'mushroom coffee', 'RYZE'],
    ...overrides,
  };
}

/** Assert the shared required fields every Finding must carry. */
function assertShape(f: Finding, ruleId: string) {
  expect(f.id).toBeTruthy();
  expect(f.fingerprint).toBeTruthy();
  expect(f.runId).toBe(RUN_ID);
  expect(f.discoveredAt).toBeTruthy();
  expect(f.ruleId).toBe(ruleId);
  expect(f.category).toBe('content');
  expect(typeof f.confidence).toBe('number');
  expect(f.title).toBeTruthy();
  expect(f.description).toBeTruthy();
}

test.describe('content-rules: checkCopyrightYear', () => {
  const url = 'https://www.ryzesuperfoods.com/pages/foo';

  test('positive: "© 2024 RYZE" with acceptable [2025,2026] → 1 finding', async () => {
    const findings = await checkCopyrightYear(url, '© 2024 RYZE, INC.', canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(1);
    assertShape(findings[0], 'content:outdated-copyright');
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].meta?.detectedYear).toBe(2024);
    expect(findings[0].confidence).toBe(1.0);
    expect(findings[0].visualGate?.verdict).toBe('visible');
  });

  test('positive: "© 2025-2024" (reversed range) → most-recent year 2025 → no finding', async () => {
    const findings = await checkCopyrightYear(url, 'Copyright © 2025-2024 RYZE', canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(0);
  });

  test('negative: "© 2026 RYZE" → 0 findings', async () => {
    const findings = await checkCopyrightYear(url, '© 2026 RYZE', canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(0);
  });

  test('edge: no copyright text → 0 findings', async () => {
    const findings = await checkCopyrightYear(url, 'Just some marketing copy about mushrooms.', canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(0);
  });

  test('edge: multiple copyright lines (same year) on one page → deduplicated to 1 finding', async () => {
    const text = 'Footer © 2024 RYZE\n... later ...\nSmall print copyright 2024 RYZE all rights reserved';
    const findings = await checkCopyrightYear(url, text, canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(1);
  });

  test('range "© 2020-2024" uses most-recent (2024) and fires', async () => {
    const findings = await checkCopyrightYear(url, '© 2020–2024 RYZE', canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(1);
    expect(findings[0].meta?.detectedYear).toBe(2024);
  });
});

test.describe('content-rules: checkBrandTerms', () => {
  const url = 'https://www.ryzesuperfoods.com/pages/bar';

  test('positive: "brandambassdor" in text, canonical "brandambassador" → 1 finding', async () => {
    const findings = await checkBrandTerms(url, 'Join our brandambassdor program today!', canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(1);
    assertShape(findings[0], 'content:brand-term-typo');
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].confidence).toBeLessThan(0.7);
    expect(findings[0].uncertain).toBe(true);
    expect(String(findings[0].meta?.canonicalTerm)).toBe('brandambassador');
  });

  test('negative: "brandambassador" exact match → 0 findings', async () => {
    const findings = await checkBrandTerms(url, 'Join our brandambassador program', canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(0);
  });

  test('negative: "Ryze" when "Ryze" is in brandVariants → 0 findings', async () => {
    const findings = await checkBrandTerms(url, 'We are Ryze and we love mushrooms', canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(0);
  });

  test('negative: brand possessive "RYZE’rs" (curly apostrophe) is not a typo of "RYZErs"', async () => {
    // The brand writes its possessive with an apostrophe; apostrophes are not
    // typos. Without normalization this fires on every page.
    const canonical = canonicalFixture({ brandTerms: ['RYZErs', 'brandambassador'] });
    const straight = await checkBrandTerms(url, "Calling all RYZE'rs!", canonical, RUN_ID);
    const curly = await checkBrandTerms(url, 'Calling all RYZE’rs!', canonical, RUN_ID);
    expect(straight).toHaveLength(0);
    expect(curly).toHaveLength(0);
  });

  test('edge: 4-letter term "RYZE" with distance match does not fire (too short)', async () => {
    // "Ryzz" is distance 1 from "RYZE" but the canonical term is only 4 chars,
    // below the 6-char floor for distance-1 matches.
    const findings = await checkBrandTerms(url, 'The Ryzz blend is here', canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(0);
  });
});

test.describe('content-rules: checkUrlTypos', () => {
  const pageA = 'https://www.ryzesuperfoods.com/';
  const pageB = 'https://www.ryzesuperfoods.com/pages/about';

  test('positive: <a href="/pages/brandambassdor"> → 1 finding', async () => {
    const html = '<html><body><a href="/pages/brandambassdor">Become an ambassador</a></body></html>';
    const findings = await checkUrlTypos(pageA, html, canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(1);
    assertShape(findings[0], 'content:url-typo');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].confidence).toBe(0.85);
    expect(String(findings[0].meta?.canonicalTerm)).toBe('brandambassador');
    expect(String(findings[0].meta?.badPath)).toContain('brandambassdor');
  });

  test('negative: <a href="/pages/brandambassador"> → 0 findings', async () => {
    const html = '<html><body><a href="/pages/brandambassador">Ambassadors</a></body></html>';
    const findings = await checkUrlTypos(pageA, html, canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(0);
  });

  test('positive: same bad URL on 2 pages → 1 finding with meta.alsoFoundOn populated', async () => {
    const html = '<html><body><a href="/pages/brandambassdor">x</a></body></html>';
    const registry = new Map<string, Finding>();
    const r1 = await checkUrlTypos(pageA, html, canonicalFixture(), RUN_ID, registry);
    const r2 = await checkUrlTypos(pageB, html, canonicalFixture(), RUN_ID, registry);
    const all = [...r1, ...r2];
    expect(all).toHaveLength(1);
    expect(String(all[0].meta?.foundOnPage)).toBe(pageA);
    expect(String(all[0].meta?.alsoFoundOn)).toContain(pageB);
    expect(all[0].relatedUrls).toContain(pageB);
  });

  test('positive: same-origin ABSOLUTE href with typo is in scope → 1 finding', async () => {
    // The real-world bug: the footer links the typo as a full absolute URL on
    // the same host, not a relative path. Same-origin absolute links are
    // first-party and must be inspected.
    const html =
      '<a href="https://www.ryzesuperfoods.com/pages/brandambassdor">Ambassadors</a>';
    const findings = await checkUrlTypos(pageA, html, canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(1);
    expect(String(findings[0].meta?.badPath)).toContain('/pages/brandambassdor');
  });

  test('edge: external <a href="https://example.com"> is ignored', async () => {
    const html = '<html><body><a href="https://example.com/brandambassdor">ext</a></body></html>';
    const findings = await checkUrlTypos(pageA, html, canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(0);
  });

  test('edge: same bad href twice on one page → 1 finding', async () => {
    const html = '<a href="/pages/brandambassdor">a</a><a href="/pages/brandambassdor">b</a>';
    const findings = await checkUrlTypos(pageA, html, canonicalFixture(), RUN_ID);
    expect(findings).toHaveLength(1);
  });
});
