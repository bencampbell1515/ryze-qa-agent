import { test, expect } from '@playwright/test';
import { fallbackCategory, buildCategoryPrompt } from '../../scripts/categorise.js';

test('fallbackCategory maps revenue rules', () => {
  expect(fallbackCategory('revenue:no-atc')).toBe('Revenue & Checkout');
});

test('fallbackCategory maps axe rules', () => {
  expect(fallbackCategory('axe:color-contrast')).toBe('Accessibility');
});

test('fallbackCategory maps network:404', () => {
  expect(fallbackCategory('network:404')).toBe('Broken Links');
});

test('fallbackCategory maps seo rules', () => {
  expect(fallbackCategory('seo:missing-canonical')).toBe('SEO Tags');
});

test('fallbackCategory maps content rules', () => {
  expect(fallbackCategory('content:typo')).toBe('Content Quality');
});

test('fallbackCategory returns Other for unknown rules', () => {
  expect(fallbackCategory('unknown:thing')).toBe('Other');
});

test('buildCategoryPrompt includes fingerprints and truncated descriptions', () => {
  const findings = [
    { fingerprint: 'fp1', ruleId: 'network:404', description: 'HTTP 404: https://example.com/broken-link' },
  ];
  const prompt = buildCategoryPrompt(findings);
  expect(prompt).toContain('fp1');
  expect(prompt).toContain('network:404');
});
