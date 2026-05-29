import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { escapeHtml, urlListHtml, buildHtml } from '../../src/report/html-builder.js';
import type { ReportTiers } from '../../src/report/finding-reader.js';
import type { Finding, HygieneFinding } from '../../src/types/finding.js';

const META = { crawlDate: '2026-05-29', totalPages: 3, sites: ['ryzesuperfoods.com'] };

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1', fingerprint: 'fp-1', runId: 'r-1', discoveredAt: '2026-05-29T00:00:00.000Z',
    ruleId: 'revenue:cart-subtotal-missing', category: 'revenue', source: 'deterministic',
    severity: 'high', url: 'https://www.ryzesuperfoods.com/products/x',
    title: 'Cart subtotal missing', description: 'The cart drawer shows no subtotal.',
    confidence: 0.65, ...overrides,
  };
}

function makeHygiene(overrides: Partial<HygieneFinding> = {}): HygieneFinding {
  return {
    id: 'h-1', runId: 'r-1', discoveredAt: '2026-05-29T00:00:00.000Z',
    reason: 'shopify-draft', url: 'https://www.ryzesuperfoods.com/products/draft-thing',
    detail: { status: 'DRAFT' }, ...overrides,
  };
}

function emptyTiers(overrides: Partial<ReportTiers> = {}): ReportTiers {
  return { main: [], uncertain: [], suppressed: [], hygiene: [], ...overrides };
}

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

// ── worktree-L: three-tier rendering ────────────────────────────────────────

test('three tier headers render when tiers are supplied', async () => {
  const tiers = emptyTiers({ uncertain: [makeFinding()], hygiene: [makeHygiene()] });
  const html = await buildHtml([], META, undefined, tiers);
  expect(html).toContain('Main findings');
  expect(html).toContain('Needs review');
  expect(html).toContain('Hygiene');
});

test('no tier headers when tiers are omitted (backward compat)', async () => {
  const html = await buildHtml([], META);
  expect(html).not.toContain('Needs review');
  expect(html).not.toContain('>Hygiene<');
});

test('an uncertain finding carries a REVIEW badge', async () => {
  const tiers = emptyTiers({ uncertain: [makeFinding({ uncertain: true })] });
  const html = await buildHtml([], META, undefined, tiers);
  expect(html).toContain('review-badge');
  expect(html).toMatch(/REVIEW/);
});

test('a finding with crop.path renders an <img> referencing that path', async () => {
  const tiers = emptyTiers({
    uncertain: [makeFinding({ crop: { path: 'r-1/f-1.png', width: 200, height: 120, padding: 8, boundingBoxDrawn: true } })],
  });
  const html = await buildHtml([], META, undefined, tiers);
  expect(html).toMatch(/<img[^>]*data-crop-path="r-1\/f-1\.png"/);
});

test('hygiene section is collapsed by default (a closed <details>)', async () => {
  const tiers = emptyTiers({ hygiene: [makeHygiene()] });
  const html = await buildHtml([], META, undefined, tiers);
  // hygiene-details present, and NOT opened
  expect(html).toMatch(/<details class="hygiene-details"(?![^>]*\bopen\b)/);
  expect(html).toContain('shopify-draft');
  expect(html).toContain('draft-thing');
});

test('judge reasoning renders collapsed for an uncertain finding with a two-judge verdict', async () => {
  const tiers = emptyTiers({
    uncertain: [makeFinding({
      uncertain: true,
      visualGate: {
        verdict: 'uncertain',
        reason: '[claude-sonnet-4-6] subtotal hidden below fold | [claude-opus-4-7] subtotal present but faint',
        judgeModel: 'claude-sonnet-4-6+claude-opus-4-7',
      },
    })],
  });
  const html = await buildHtml([], META, undefined, tiers);
  expect(html).toMatch(/<details class="judge-reasoning"(?![^>]*\bopen\b)/);
  expect(html).toContain('claude-sonnet-4-6');
  expect(html).toContain('claude-opus-4-7');
  expect(html).toContain('subtotal hidden below fold');
});

test('confidence badge color matches the threshold band', async () => {
  const high: any = { fingerprint: 'a', ruleId: 'seo:x', severity: 'high', bugClass: 'seo', title: 't',
    description: 'd', urls: ['https://www.ryzesuperfoods.com/a'], viewports: ['desktop'], instanceCount: 1,
    score: 1, source: 'playwright', confidence: 0.9, consensusCount: 1 };
  const mid: any = { ...high, fingerprint: 'b', confidence: 0.6 };
  const low: any = { ...high, fingerprint: 'c', confidence: 0.3 };
  const html = await buildHtml([high, mid, low], META, undefined, emptyTiers());
  expect(html).toContain('confidence-badge high');
  expect(html).toContain('confidence-badge medium');
  expect(html).toContain('confidence-badge low');
});

test('empty uncertain/hygiene tiers render a placeholder, not a crash', async () => {
  const html = await buildHtml([], META, undefined, emptyTiers());
  expect(html).toContain('Needs review');
  expect(html).toContain('tier-empty');
});

test('rubric verdicts render per-dimension for a rubric finding', async () => {
  const tiers = emptyTiers({
    uncertain: [makeFinding({
      source: 'rubric',
      rubricVerdicts: [
        { rubricId: 'cart-summary-v1', dimension: 'subtotal-present', verdict: 'fail', confidence: 0.7,
          discrepancy: 'no subtotal line found', judgeModel: 'claude-sonnet-4-6' },
      ],
    })],
  });
  const html = await buildHtml([], META, undefined, tiers);
  expect(html).toContain('rubric-verdicts');
  expect(html).toContain('subtotal-present');
  expect(html).toContain('no subtotal line found');
});
