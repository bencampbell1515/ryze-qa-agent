import { test, expect } from '@playwright/test';
import { applyScopeFilter, type ScopeFilterConfig } from '../../src/discovery/scope-filter.js';

const RUN_ID = 'run-test-001';

const cfg = (over: Partial<ScopeFilterConfig> = {}): ScopeFilterConfig => ({
  denyPatterns: ['/products/copy-of-', '/luka/cro-tests/', '/cart/mc-ca', '/cart/mc01-dynamic'],
  allowOverrides: [],
  ...over,
});

test.describe('scope-filter: applyScopeFilter', () => {
  test('positive: /products/copy-of-foo matches deny-list → excluded', () => {
    const url = 'https://www.ryzesuperfoods.com/products/copy-of-handmade-acacia-spoon';
    const res = applyScopeFilter([url], cfg(), RUN_ID);
    expect(res.audit).toHaveLength(0);
    expect(res.hygiene).toHaveLength(1);
    expect(res.hygiene[0].reason).toBe('deny-list-match');
    expect(res.hygiene[0].url).toBe(url);
    expect(res.hygiene[0].detail?.pattern).toBe('/products/copy-of-');
    expect(res.hygiene[0].runId).toBe(RUN_ID);
    expect(res.hygiene[0].id).toBeTruthy();
    expect(res.hygiene[0].discoveredAt).toBeTruthy();
  });

  test('positive: /luka/cro-tests/v1 excluded', () => {
    const url = 'https://www.ryzesuperfoods.com/luka/cro-tests/creative-single-bag-image-testing/v1-modern-experience';
    const res = applyScopeFilter([url], cfg(), RUN_ID);
    expect(res.audit).toHaveLength(0);
    expect(res.hygiene).toHaveLength(1);
    expect(res.hygiene[0].detail?.pattern).toBe('/luka/cro-tests/');
  });

  test('negative: /products/mushroom-coffee survives', () => {
    const url = 'https://www.ryzesuperfoods.com/products/mushroom-coffee';
    const res = applyScopeFilter([url], cfg(), RUN_ID);
    expect(res.audit).toEqual([url]);
    expect(res.hygiene).toHaveLength(0);
  });

  test('edge: URL in allowOverrides survives despite matching a deny pattern', () => {
    const url = 'https://www.ryzesuperfoods.com/products/copy-of-keep-this-one';
    const res = applyScopeFilter([url], cfg({ allowOverrides: [url] }), RUN_ID);
    expect(res.audit).toEqual([url]);
    expect(res.hygiene).toHaveLength(0);
  });

  test('edge: empty input returns empty output (no errors)', () => {
    const res = applyScopeFilter([], cfg(), RUN_ID);
    expect(res.audit).toEqual([]);
    expect(res.hygiene).toEqual([]);
  });

  test('mixed list: survivors preserved in order, only matches excluded', () => {
    const urls = [
      'https://www.ryzesuperfoods.com/products/mushroom-coffee',
      'https://www.ryzesuperfoods.com/products/copy-of-foo',
      'https://www.ryzesuperfoods.com/cart/mc01-dynamic',
      'https://www.ryzesuperfoods.com/collections/all',
    ];
    const res = applyScopeFilter(urls, cfg(), RUN_ID);
    expect(res.audit).toEqual([
      'https://www.ryzesuperfoods.com/products/mushroom-coffee',
      'https://www.ryzesuperfoods.com/collections/all',
    ]);
    expect(res.hygiene.map((h) => h.url)).toEqual([
      'https://www.ryzesuperfoods.com/products/copy-of-foo',
      'https://www.ryzesuperfoods.com/cart/mc01-dynamic',
    ]);
  });

  test('escape hatch: re: prefix is treated as a regex', () => {
    const urls = [
      'https://www.ryzesuperfoods.com/products/test-v1',
      'https://www.ryzesuperfoods.com/products/keep',
    ];
    const res = applyScopeFilter(urls, cfg({ denyPatterns: ['re:/products/test-v\\d+$'] }), RUN_ID);
    expect(res.audit).toEqual(['https://www.ryzesuperfoods.com/products/keep']);
    expect(res.hygiene).toHaveLength(1);
    expect(res.hygiene[0].detail?.pattern).toBe('re:/products/test-v\\d+$');
  });

  test('a URL matching multiple patterns is excluded once, attributing the first match', () => {
    const url = 'https://www.ryzesuperfoods.com/products/copy-of-thing';
    const res = applyScopeFilter([url], cfg({ denyPatterns: ['/products/', '/products/copy-of-'] }), RUN_ID);
    expect(res.audit).toHaveLength(0);
    expect(res.hygiene).toHaveLength(1);
    expect(res.hygiene[0].detail?.pattern).toBe('/products/');
  });
});
