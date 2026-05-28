import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { checkPageLanguage, type LanguageCheckConfig } from '../../src/cross-page/language.js';

const RUN_ID = 'test-run';

/** Locale prefix map mirroring config/canonical-record.json. */
const PREFIXES: LanguageCheckConfig = {
  localePathPrefixes: { es: '/es/', fr: '/fr/' },
};

function fx(name: string): string {
  return readFileSync(new URL(`../fixtures/language/${name}.txt`, import.meta.url), 'utf8');
}

test.describe('cross-page/language: checkPageLanguage', () => {
  test('positive: Spanish page ~50% English blocks → 1 finding, ratio ~0.5', async () => {
    const res = await checkPageLanguage(
      'https://www.ryzesuperfoods.com/es/fbo/mushroom-coffee',
      fx('es-with-english'),
      PREFIXES,
      RUN_ID,
    );

    expect(res.expectedLanguage).toBe('es');
    expect(res.mixedBlockRatio).toBeGreaterThan(0.4);
    expect(res.mixedBlockRatio).toBeLessThan(0.6);
    expect(res.findings).toHaveLength(1);

    const f = res.findings[0];
    expect(f.ruleId).toBe('i18n:mixed-locale-content');
    expect(f.category).toBe('i18n');
    expect(f.source).toBe('cross-page');
    expect(f.severity).toBe('high');
    expect(f.runId).toBe(RUN_ID);
    expect(f.url).toBe('https://www.ryzesuperfoods.com/es/fbo/mushroom-coffee');
    expect(f.title).toContain('Mixed-locale');
    expect(f.confidence).toBeGreaterThan(0);
    expect(f.confidence).toBeLessThanOrEqual(1);
    // pre-confirmed visible (no single element to gate)
    expect(f.visualGate?.verdict).toBe('visible');
    // meta carries the scalar evidence
    expect(f.meta?.expectedLanguage).toBe('es');
    expect(f.meta?.dominantDetected).toBe('en');
    expect(typeof f.meta?.mixedBlockRatio).toBe('number');
    expect(f.meta?.blockCount).toBe(8);
  });

  test('negative: 100% Spanish page → 0 findings', async () => {
    const res = await checkPageLanguage(
      'https://www.ryzesuperfoods.com/es/fbo/mushroom-coffee',
      fx('es-clean'),
      PREFIXES,
      RUN_ID,
    );
    expect(res.expectedLanguage).toBe('es');
    expect(res.findings).toHaveLength(0);
    expect(res.mixedBlockRatio).toBe(0);
  });

  test('negative: URL without a locale prefix → skipped, 0 findings', async () => {
    const res = await checkPageLanguage(
      'https://www.ryzesuperfoods.com/products/mushroom-coffee',
      fx('es-with-english'),
      PREFIXES,
      RUN_ID,
    );
    expect(res.expectedLanguage).toBeNull();
    expect(res.findings).toHaveLength(0);
  });

  test('positive: French path with Spanish content → 1 finding, relatedUrls points at /es/ equivalent', async () => {
    const url = 'https://www.ryzesuperfoods.com/fr/pages/mushroom-chicory-espanol';
    const res = await checkPageLanguage(url, fx('fr-path-spanish-content'), PREFIXES, RUN_ID);

    expect(res.expectedLanguage).toBe('fr');
    expect(res.findings).toHaveLength(1);
    const f = res.findings[0];
    expect(f.meta?.dominantDetected).toBe('es');
    expect(res.mixedBlockRatio).toBeGreaterThan(0.9);
    // /fr/ → /es/ correct-locale equivalent for reviewer context
    expect(f.relatedUrls).toContain('https://www.ryzesuperfoods.com/es/pages/mushroom-chicory-espanol');
  });

  test('edge: text below minBlockLength → 0 findings (no false positive)', async () => {
    const res = await checkPageLanguage(
      'https://www.ryzesuperfoods.com/es/fbo/mushroom-coffee',
      fx('short-blocks'),
      PREFIXES,
      RUN_ID,
    );
    expect(res.findings).toHaveLength(0);
    expect(res.mixedBlockRatio).toBe(0);
  });

  test('edge: blocks below minBlockConfidence do not count toward the mixed ratio', async () => {
    const res = await checkPageLanguage(
      'https://www.ryzesuperfoods.com/es/fbo/mushroom-coffee',
      fx('es-with-english'),
      { ...PREFIXES, minBlockConfidence: 0.9 },
      RUN_ID,
    );
    // English blocks detect at ~0.73-0.80 < 0.9, so none count as confidently mismatched
    expect(res.mixedBlockRatio).toBe(0);
    expect(res.findings).toHaveLength(0);
  });

  test('threshold tuning: ratio exactly at threshold does not fire (only strictly above)', async () => {
    const res = await checkPageLanguage(
      'https://www.ryzesuperfoods.com/es/fbo/mushroom-coffee',
      fx('es-with-english'),
      { ...PREFIXES, mixedThreshold: 0.5 },
      RUN_ID,
    );
    // ratio is exactly 0.5; 0.5 > 0.5 is false
    expect(res.mixedBlockRatio).toBeCloseTo(0.5, 5);
    expect(res.findings).toHaveLength(0);
  });

  test('known-bad slug: /pages/...-espanol (no path prefix) → expected es via slug marker, 1 finding', async () => {
    const res = await checkPageLanguage(
      'https://www.ryzesuperfoods.com/pages/mushroom-dark-roast-espanol',
      fx('es-with-english'),
      PREFIXES,
      RUN_ID,
    );
    expect(res.expectedLanguage).toBe('es');
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].meta?.dominantDetected).toBe('en');
  });

  test('fingerprint is stable across runs for the same url + expected language', async () => {
    const url = 'https://www.ryzesuperfoods.com/es/fbo/mushroom-coffee';
    const a = await checkPageLanguage(url, fx('es-with-english'), PREFIXES, RUN_ID);
    const b = await checkPageLanguage(url, fx('es-with-english'), PREFIXES, 'a-different-run');
    expect(a.findings[0].fingerprint).toBe(b.findings[0].fingerprint);
  });
});
