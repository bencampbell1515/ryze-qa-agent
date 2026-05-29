import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { escapeHtml, urlListHtml, buildHtml } from '../../src/report/html-builder.js';

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

test('buildHtml renders gate-degraded banner when degradedCount > 0', async () => {
  const html = await buildHtml([], { crawlDate: '2026-05-12', totalPages: 0, sites: ['example.com'] }, { degradedCount: 5, totalGated: 50 });
  expect(html).toMatch(/visual gate degraded/i);
  expect(html).toContain('5');
  expect(html).toContain('50');
});

test('buildHtml omits gate-degraded banner when degradedCount = 0', async () => {
  const html = await buildHtml([], { crawlDate: '2026-05-12', totalPages: 0, sites: ['example.com'] });
  expect(html).not.toMatch(/visual gate degraded/i);
});

test('buildHtml labels a tight element crop as "flagged element" in the figcaption', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-html-'));
  const shot = join(dir, 'c.png');
  await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toFile(shot);

  const bug: any = {
    fingerprint: 'fp1',
    ruleId: 'content:broken-image',
    severity: 'high',
    bugClass: 'content',
    title: 'Broken image',
    description: 'A visible image renders empty.',
    urls: ['https://www.ryzesuperfoods.com/products/x'],
    viewports: ['mobile'],
    instanceCount: 1,
    score: 10,
    source: 'playwright',
    confidence: 1,
    consensusCount: 1,
    elementShot: shot,
  };
  const html = await buildHtml([bug], { crawlDate: '2026-05-12', totalPages: 1, sites: ['ryzesuperfoods.com'] });
  expect(html).toContain('flagged element');
});
