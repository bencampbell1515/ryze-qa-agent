import { test, expect } from '@playwright/test';
import { classifySearchPage } from '../checks/search.js';

test.describe('classifySearchPage', () => {
  test('returns "http-error" when status >= 400', () => {
    const result = classifySearchPage('any body text', 5, 404);
    expect(result).toBe('http-error');
  });

  test('returns "http-error" for status 500', () => {
    const result = classifySearchPage('any body text', 5, 500);
    expect(result).toBe('http-error');
  });

  test('returns "no-results" when body has no-results text and no product links', () => {
    const result = classifySearchPage('No results found for your search', 0, 200);
    expect(result).toBe('no-results');
  });

  test('returns "no-results" for various no-results patterns', () => {
    expect(classifySearchPage('0 results', 0, 200)).toBe('no-results');
    expect(classifySearchPage('Sorry, nothing matched your query', 0, 200)).toBe('no-results');
    expect(classifySearchPage('No matches found', 0, 200)).toBe('no-results');
    expect(classifySearchPage("Couldn't find what you're looking for", 0, 200)).toBe('no-results');
  });

  test('returns "rendering-broken" when body has no no-results text and no product links', () => {
    const result = classifySearchPage('Some random content here', 0, 200);
    expect(result).toBe('rendering-broken');
  });

  test('returns "ok" when product links are found (regardless of no-results text)', () => {
    const result = classifySearchPage('Some content', 3, 200);
    expect(result).toBe('ok');
  });

  test('returns "ok" even if no-results text is present when product links exist', () => {
    const result = classifySearchPage('No results found but here are some products', 2, 200);
    expect(result).toBe('ok');
  });

  test('handles case-insensitive no-results patterns', () => {
    expect(classifySearchPage('NO RESULTS', 0, 200)).toBe('no-results');
    expect(classifySearchPage('SORRY, NOTHING', 0, 200)).toBe('no-results');
  });
});
