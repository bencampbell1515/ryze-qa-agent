import { test, expect } from '@playwright/test';
import { escapeHtml, urlListHtml } from '../../src/report/html-builder.js';

test('escapeHtml encodes ampersands', () => {
  expect(escapeHtml('a & b')).toBe('a &amp; b');
});

test('escapeHtml encodes angle brackets', () => {
  expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
});

test('escapeHtml encodes double quotes', () => {
  expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
});

test('urlListHtml renders all URLs when 5 or fewer', () => {
  const html = urlListHtml(['https://a.com', 'https://b.com']);
  expect(html).toContain('https://a.com');
  expect(html).toContain('https://b.com');
  expect(html).not.toContain('show-more-btn');
});

test('urlListHtml collapses URLs beyond 5 into overflow', () => {
  const urls = ['https://a.com', 'https://b.com', 'https://c.com',
                'https://d.com', 'https://e.com', 'https://f.com'];
  const html = urlListHtml(urls);
  expect(html).toContain('show-more-btn');
  expect(html).toContain('url-overflow hidden');
  expect(html).toContain('https://f.com');
});
