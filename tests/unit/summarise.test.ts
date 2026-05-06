import { test, expect } from '@playwright/test';
import { buildSummaryPrompt, SUMMARY_MODEL } from '../../scripts/summarise.js';
import type { ScoredBug } from '../../src/types.js';

const fakeBug: ScoredBug = {
  fingerprint: 'abc123',
  ruleId: 'revenue:no-atc',
  severity: 'critical',
  bugClass: 'revenue',
  title: 'No ATC button',
  description: 'No Add-to-Cart button visible on product page',
  urls: ['https://www.ryzesuperfoods.com/products/mushroom-coffee'],
  viewports: ['desktop'],
  instanceCount: 1,
  score: 9,
  source: 'playwright',
  confidence: 1.0,
  consensusCount: 1,
};

test('SUMMARY_MODEL returns sonnet for critical', () => {
  expect(SUMMARY_MODEL('critical')).toBe('claude-sonnet-4-6');
});

test('SUMMARY_MODEL returns sonnet for high', () => {
  expect(SUMMARY_MODEL('high')).toBe('claude-sonnet-4-6');
});

test('SUMMARY_MODEL returns sonnet for medium', () => {
  expect(SUMMARY_MODEL('medium')).toBe('claude-sonnet-4-6');
});

test('SUMMARY_MODEL returns haiku for low', () => {
  expect(SUMMARY_MODEL('low')).toBe('claude-haiku-4-5-20251001');
});

test('buildSummaryPrompt includes ruleId and description', () => {
  const prompt = buildSummaryPrompt(fakeBug);
  expect(prompt).toContain('revenue:no-atc');
  expect(prompt).toContain('No Add-to-Cart button visible on product page');
});

test('buildSummaryPrompt includes up to 3 URLs', () => {
  const bug = { ...fakeBug, urls: ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'] };
  const prompt = buildSummaryPrompt(bug);
  expect(prompt).toContain('https://a.com');
  expect(prompt).toContain('https://c.com');
  expect(prompt).not.toContain('https://d.com');
});
