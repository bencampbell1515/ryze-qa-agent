// tests/unit/evidence-enforcer.test.ts
import { test, expect } from '@playwright/test';
import { enforceEvidence } from '../../src/scoring/evidence-enforcer.js';

test('passes when all four fields are present', () => {
  const result = enforceEvidence({
    url: 'https://www.ryzesuperfoods.com/products/coffee',
    screenshot: 'output/screenshots/coffee-desktop.png',
    quotedElement: '<span class="price">$39.99</span>',
    claim: 'Bundle price is higher than buying items separately',
    persona: 'revenue-hawk',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:pricing',
    timestamp: new Date().toISOString(),
  });
  expect(result.valid).toBe(true);
  expect(result.reason).toBeUndefined();
});

test('rejects when url is missing', () => {
  const result = enforceEvidence({
    screenshot: 'output/screenshots/coffee-desktop.png',
    quotedElement: '<span>text</span>',
    claim: 'some claim',
    persona: 'revenue-hawk',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:pricing',
    timestamp: new Date().toISOString(),
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('missing url');
});

test('rejects when screenshot is missing', () => {
  const result = enforceEvidence({
    url: 'https://www.ryzesuperfoods.com/products/coffee',
    quotedElement: '<span>text</span>',
    claim: 'some claim',
    persona: 'revenue-hawk',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:pricing',
    timestamp: new Date().toISOString(),
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('missing screenshot');
});

test('rejects when quotedElement is missing', () => {
  const result = enforceEvidence({
    url: 'https://www.ryzesuperfoods.com/products/coffee',
    screenshot: 'output/screenshots/coffee-desktop.png',
    claim: 'some claim',
    persona: 'revenue-hawk',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:pricing',
    timestamp: new Date().toISOString(),
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('missing quotedElement');
});

test('rejects when claim is missing', () => {
  const result = enforceEvidence({
    url: 'https://www.ryzesuperfoods.com/products/coffee',
    screenshot: 'output/screenshots/coffee-desktop.png',
    quotedElement: '<span>text</span>',
    persona: 'revenue-hawk',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:pricing',
    timestamp: new Date().toISOString(),
  });
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('missing claim');
});
