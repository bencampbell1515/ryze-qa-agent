import { test, expect } from '@playwright/test';
import { buildHtml } from '../../src/report/html-builder.js';
import { SAMPLE_META, SAMPLE_MAIN_BUGS, sampleTiers } from '../fixtures/three-tier-sample.js';

/**
 * "Snapshot" test for the three-tier report. The repo has no toMatchSnapshot /
 * toHaveScreenshot pattern (the latter is explicitly banned — see tests/CLAUDE.md),
 * so per the worktree-L brief we assert structural invariants over a full render
 * of the all-tiers fixture instead. This is the structural equivalent of a
 * snapshot: it pins the document skeleton, tier ordering, and per-tier content
 * without being brittle to whitespace.
 */

test('full three-tier render pins the document structure and tier ordering', async () => {
  const html = await buildHtml(SAMPLE_MAIN_BUGS, SAMPLE_META, undefined, sampleTiers());

  // Document skeleton
  expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  expect(html).toContain('<title>Ryze QA Audit Report — 2026-05-29</title>');

  // Summary bar counts (1 critical, 1 high, 1 medium, 1 low in the fixture)
  expect(html).toContain('1 Critical');
  expect(html).toContain('1 High');
  expect(html).toContain('1 Medium');
  expect(html).toContain('1 Low');

  // All three tier headings present, in order: Main findings → Needs review → Hygiene
  const iMain = html.indexOf('Main findings');
  const iReview = html.indexOf('Needs review');
  const iHygiene = html.indexOf('>Hygiene<');
  expect(iMain).toBeGreaterThan(-1);
  expect(iReview).toBeGreaterThan(iMain);
  expect(iHygiene).toBeGreaterThan(iReview);

  // Main tier: every fixture rule id is present, NaN-subtotal critical is confirmed
  expect(html).toContain('revenue:cart-subtotal-nan');
  expect(html).toContain('content:broken-image');
  expect(html).toContain('✓ Confirmed');

  // Main tier confidence badges span all three color bands
  expect(html).toContain('confidence-badge high');
  expect(html).toContain('confidence-badge medium');
  expect(html).toContain('confidence-badge low');

  // Uncertain tier: REVIEW badge, both findings, two-judge reasoning collapsed,
  // rubric per-dimension breakdown for the rubric finding.
  expect(html).toContain('review-badge');
  expect(html).toContain('revenue:countdown-stuck');
  expect(html).toContain('revenue:discount-math');
  expect(html).toMatch(/<details class="judge-reasoning"(?![^>]*\bopen\b)/);
  expect(html).toContain('claude-opus-4-7');
  expect(html).toContain('rubric-verdicts');
  expect(html).toContain('badge-matches-price');
  expect(html).toContain('$24.90');
  // crop provenance is referenced even though the PNGs aren't on disk in CI
  expect(html).toMatch(/data-crop-path="sample\/u-1\.png"/);

  // Hygiene tier: collapsed by default, lists scope-filter + shopify exclusions
  expect(html).toMatch(/<details class="hygiene-details"(?![^>]*\bopen\b)/);
  expect(html).toContain('shopify-draft');
  expect(html).toContain('deny-list-match');
  expect(html).toContain('copy-of-mushroom-coffee');

  // Suppressed pile is NOT rendered as a fourth tier (three is the design).
  expect(html).not.toContain('s-fp-1');
  expect(html).not.toContain('Suppressed findings');
});

test('main-only render (no tiers) omits the uncertain and hygiene sections', async () => {
  const html = await buildHtml(SAMPLE_MAIN_BUGS, SAMPLE_META);
  expect(html).toContain('revenue:cart-subtotal-nan');
  expect(html).not.toContain('Needs review');
  expect(html).not.toContain('>Hygiene<');
  // the .review-badge CSS class is always in <style>; assert the rendered span isn't.
  expect(html).not.toContain('<span class="review-badge">REVIEW</span>');
});
