import { test, expect } from '@playwright/test';
import { parsePrice } from '../checks/revenue.js';

test('parsePrice: standard dollar amount with cents', () => {
  expect(parsePrice('$29.99')).toBeCloseTo(29.99);
});

test('parsePrice: dollar amount with comma separator', () => {
  expect(parsePrice('$1,234.56')).toBeCloseTo(1234.56);
});

test('parsePrice: no cents', () => {
  expect(parsePrice('$30')).toBeCloseTo(30);
});

test('parsePrice: strips all non-numeric chars except dot', () => {
  expect(parsePrice('USD 45.00')).toBeCloseTo(45.0);
});

test('parsePrice: empty string returns NaN', () => {
  expect(isNaN(parsePrice(''))).toBe(true);
});
