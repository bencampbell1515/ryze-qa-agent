import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFinding, toBugInstance, type BuildFindingInput } from '../../src/findings/index.js';
import type { Finding } from '../../src/types/finding.js';

const baseInput: BuildFindingInput = {
  runId: 'run-1',
  url: 'https://www.ryzesuperfoods.com/products/mushroom-coffee',
  ruleId: 'revenue:no-price',
  category: 'revenue',
  severity: 'critical',
  title: 'No visible price',
  description: 'No visible price found on the product page.',
};

// ───────────────────────────── buildFinding ────────────────────────────────

test('buildFinding: minimal input produces a valid Finding with required fields', () => {
  const f = buildFinding(baseInput);
  expect(f.id).toMatch(/^f-run-1-[0-9a-f]{8}$/);
  expect(f.fingerprint).toMatch(/^[0-9a-f]{40}$/);
  expect(f.runId).toBe('run-1');
  expect(f.discoveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(f.ruleId).toBe('revenue:no-price');
  expect(f.category).toBe('revenue');
  expect(f.source).toBe('deterministic');
  expect(f.severity).toBe('critical');
  expect(f.url).toBe(baseInput.url);
  expect(f.title).toBe('No visible price');
  expect(f.description).toBe('No visible price found on the product page.');
  expect(f.confidence).toBe(0.9); // default for deterministic checks
  expect(f.element).toBeUndefined();
  expect(f.crop).toBeUndefined();
  expect(f.visualGate).toBeUndefined(); // let the gate run as it does today
});

test('buildFinding: explicit confidence overrides the default', () => {
  const f = buildFinding({ ...baseInput, confidence: 0.55 });
  expect(f.confidence).toBe(0.55);
});

test('buildFinding: selector is folded into element.selector when no element given', () => {
  const f = buildFinding({ ...baseInput, selector: 'button[name=add]' });
  expect(f.element?.selector).toBe('button[name=add]');
});

test('buildFinding: explicit element is preserved and viewport carried through', () => {
  const f = buildFinding({
    ...baseInput,
    element: { role: 'button', name: 'Add to cart', selector: 'button.atc' },
    viewport: 'mobile',
  });
  expect(f.element).toEqual({ role: 'button', name: 'Add to cart', selector: 'button.atc' });
  expect(f.viewport).toBe('mobile');
});

test('buildFinding: cropPath populates crop with real PNG dimensions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryze-crop-'));
  try {
    const cropPath = join(dir, 'crop.png');
    await sharp({ create: { width: 24, height: 11, channels: 3, background: '#fff' } })
      .png()
      .toFile(cropPath);

    const f = buildFinding({ ...baseInput, cropPath });
    expect(f.crop).toBeDefined();
    expect(f.crop!.path).toBe(cropPath);
    expect(f.crop!.width).toBe(24);
    expect(f.crop!.height).toBe(11);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildFinding: pageScreenshotPath populates fullPageScreenshotPath', () => {
  const f = buildFinding({ ...baseInput, pageScreenshotPath: '/output/screenshots/page.png' });
  expect(f.fullPageScreenshotPath).toBe('/output/screenshots/page.png');
});

test('buildFinding: fingerprint is stable across two calls with the same input', () => {
  const a = buildFinding(baseInput);
  const b = buildFinding(baseInput);
  expect(a.fingerprint).toBe(b.fingerprint);
});

test('buildFinding: fingerprint changes when the URL changes', () => {
  const a = buildFinding(baseInput);
  const b = buildFinding({ ...baseInput, url: baseInput.url + '-2' });
  expect(a.fingerprint).not.toBe(b.fingerprint);
});

test('buildFinding: fingerprint changes when the ruleId changes', () => {
  const a = buildFinding(baseInput);
  const b = buildFinding({ ...baseInput, ruleId: 'revenue:no-atc' });
  expect(a.fingerprint).not.toBe(b.fingerprint);
});

test('buildFinding: fingerprint changes when the element signature (role+name) changes', () => {
  const a = buildFinding({ ...baseInput, element: { role: 'button', name: 'Add to cart' } });
  const b = buildFinding({ ...baseInput, element: { role: 'button', name: 'Subscribe' } });
  expect(a.fingerprint).not.toBe(b.fingerprint);
});

test('buildFinding: id short hash equals the first 8 chars of the fingerprint', () => {
  const f = buildFinding(baseInput);
  expect(f.id).toBe(`f-run-1-${f.fingerprint.slice(0, 8)}`);
});

test('buildFinding: outerHtmlSnippet and meta are merged into meta', () => {
  const f = buildFinding({
    ...baseInput,
    outerHtmlSnippet: '<button>Add</button>',
    meta: { expectedPrice: 30 },
  });
  expect(f.meta).toMatchObject({
    outerHtmlSnippet: '<button>Add</button>',
    expectedPrice: 30,
  });
});

test('buildFinding: empty meta produces no meta field on the output', () => {
  const f = buildFinding(baseInput);
  expect(f.meta).toBeUndefined();
});

test('buildFinding: legacyBugClass is preserved in meta', () => {
  const f = buildFinding({ ...baseInput, category: 'content', legacyBugClass: 'lighthouse' });
  expect(f.meta?.legacyBugClass).toBe('lighthouse');
});

// ───────────────────────────── toBugInstance ───────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-run-1-deadbeef',
    fingerprint: 'deadbeef0000000000000000000000000000beef',
    runId: 'run-1',
    discoveredAt: '2026-05-29T12:00:00.000Z',
    ruleId: 'revenue:no-price',
    category: 'revenue',
    source: 'deterministic',
    severity: 'critical',
    url: 'https://www.ryzesuperfoods.com/products/x',
    title: 'No price',
    description: 'No visible price found on the product page.',
    confidence: 0.9,
    ...overrides,
  };
}

test('toBugInstance: maps ruleId, severity, url and message (from description)', () => {
  const b = toBugInstance(makeFinding());
  expect(b.ruleId).toBe('revenue:no-price');
  expect(b.severity).toBe('critical');
  expect(b.url).toBe('https://www.ryzesuperfoods.com/products/x');
  expect(b.message).toBe('No visible price found on the product page.');
});

test('toBugInstance: derives bugClass from category (revenue → revenue)', () => {
  expect(toBugInstance(makeFinding({ category: 'revenue' })).bugClass).toBe('revenue');
  expect(toBugInstance(makeFinding({ category: 'seo' })).bugClass).toBe('seo');
  expect(toBugInstance(makeFinding({ category: 'network' })).bugClass).toBe('network');
});

test('toBugInstance: category with no bugClass equivalent maps to closest', () => {
  expect(toBugInstance(makeFinding({ category: 'i18n' })).bugClass).toBe('content');
  expect(toBugInstance(makeFinding({ category: 'cross-page' })).bugClass).toBe('content');
  expect(toBugInstance(makeFinding({ category: 'visual-regression' })).bugClass).toBe('visual');
});

test('toBugInstance: legacyBugClass in meta round-trips exactly', () => {
  const f = buildFinding({ ...baseInput, category: 'content', legacyBugClass: 'lighthouse' });
  expect(toBugInstance(f).bugClass).toBe('lighthouse');
});

test('toBugInstance: a Finding with element + crop → selector + elementScreenshot', () => {
  const b = toBugInstance(
    makeFinding({
      element: { selector: 'button[name=add]', role: 'button', name: 'Add to cart' },
      crop: { path: '/output/crops/run-1/f.png', width: 24, height: 11, padding: 16, boundingBoxDrawn: true },
    }),
  );
  expect(b.selector).toBe('button[name=add]');
  expect(b.elementScreenshot).toBe('/output/crops/run-1/f.png');
});

test('toBugInstance: a Finding without element → no selector', () => {
  const b = toBugInstance(makeFinding());
  expect(b.selector).toBeUndefined();
});

test('toBugInstance: meta.outerHtmlSnippet → outerHTMLSnippet', () => {
  const b = toBugInstance(makeFinding({ meta: { outerHtmlSnippet: '<button>Add</button>' } }));
  expect(b.outerHTMLSnippet).toBe('<button>Add</button>');
});

test('toBugInstance: fullPageScreenshotPath → pageScreenshot', () => {
  const b = toBugInstance(makeFinding({ fullPageScreenshotPath: '/output/screenshots/page.png' }));
  expect(b.pageScreenshot).toBe('/output/screenshots/page.png');
});

test('toBugInstance: viewport carried through, defaults to desktop when absent', () => {
  expect(toBugInstance(makeFinding({ viewport: 'mobile' })).viewport).toBe('mobile');
  expect(toBugInstance(makeFinding({ viewport: undefined })).viewport).toBe('desktop');
});

test('toBugInstance: confidence and timestamp (from discoveredAt) carried through', () => {
  const b = toBugInstance(makeFinding({ confidence: 0.77 }));
  expect(b.confidence).toBe(0.77);
  expect(b.timestamp).toBe('2026-05-29T12:00:00.000Z');
});

test('toBugInstance: rubricVerdicts are ignored (legacy pipeline never used them)', () => {
  const b = toBugInstance(
    makeFinding({
      rubricVerdicts: [
        { rubricId: 'r1', dimension: 'd1', verdict: 'fail', confidence: 0.9, judgeModel: 'claude-sonnet-4-6' },
      ],
    }),
  );
  // BugInstance has no field for rubric verdicts; the shape is unchanged.
  expect(b).not.toHaveProperty('rubricVerdicts');
  expect(b.ruleId).toBe('revenue:no-price');
});
