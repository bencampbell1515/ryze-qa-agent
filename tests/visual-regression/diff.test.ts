import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { diffTemplate, type DiffConfig } from '../../src/visual-regression/diff.js';

const TEMPLATE = 'sample';
const VIEWPORT = 'desktop';
const RUN_ID = 'testrun';

type RGBA = [number, number, number, number];

/** Write a solid-color PNG of the given size. */
function writeSolidPng(path: string, width: number, height: number, color: RGBA): void {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    png.data[o] = color[0];
    png.data[o + 1] = color[1];
    png.data[o + 2] = color[2];
    png.data[o + 3] = color[3];
  }
  writeFileSync(path, PNG.sync.write(png));
}

/** Write a solid-color PNG with a handful of individual pixels flipped to black. */
function writeNoisyPng(
  path: string,
  width: number,
  height: number,
  base: RGBA,
  flipCount: number,
): void {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    png.data[o] = base[0];
    png.data[o + 1] = base[1];
    png.data[o + 2] = base[2];
    png.data[o + 3] = base[3];
  }
  for (let i = 0; i < flipCount; i++) {
    const o = i * 4;
    png.data[o] = 0;
    png.data[o + 1] = 0;
    png.data[o + 2] = 0;
    png.data[o + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
}

function freshDirs(): DiffConfig {
  const baselineDir = mkdtempSync(join(tmpdir(), 'vr-base-'));
  const currentDir = mkdtempSync(join(tmpdir(), 'vr-cur-'));
  return { baselineDir, currentDir };
}

function baselineFile(cfg: DiffConfig): string {
  return join(cfg.baselineDir, `${TEMPLATE}-${VIEWPORT}.png`);
}
function currentFile(cfg: DiffConfig): string {
  return join(cfg.currentDir, `${TEMPLATE}-${VIEWPORT}.png`);
}

const WHITE: RGBA = [255, 255, 255, 255];
const RED: RGBA = [255, 0, 0, 255];

test.describe('visual-regression: diffTemplate', () => {
  test('identical baseline + current → 0 findings', async () => {
    const cfg = freshDirs();
    writeSolidPng(baselineFile(cfg), 100, 100, WHITE);
    writeSolidPng(currentFile(cfg), 100, 100, WHITE);

    const result = await diffTemplate(TEMPLATE, VIEWPORT, cfg, RUN_ID);

    expect(result.findings).toHaveLength(0);
    expect(result.diffPath).toBeNull();
    expect(result.diffPixelRatio).toBe(0);
  });

  test('clearly different current (different background) → 1 finding, high ratio', async () => {
    const cfg = freshDirs();
    writeSolidPng(baselineFile(cfg), 100, 100, WHITE);
    writeSolidPng(currentFile(cfg), 100, 100, RED);

    const result = await diffTemplate(TEMPLATE, VIEWPORT, cfg, RUN_ID);

    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.ruleId).toBe('visual-regression:template-changed');
    expect(f.category).toBe('visual-regression');
    expect(f.source).toBe('visual-regression');
    expect(f.severity).toBe('medium');
    expect(f.confidence).toBe(0.5);
    expect(f.uncertain).toBe(true);
    expect(result.diffPixelRatio).toBeGreaterThan(0.9);
    expect(result.diffPath).not.toBeNull();
    expect(existsSync(result.diffPath!)).toBe(true);
    expect(f.meta?.diffPixelRatio).toBe(result.diffPixelRatio);
  });

  test('small sub-threshold noise → 0 findings', async () => {
    const cfg = freshDirs();
    // 100×100 = 10,000 px. 2 flipped pixels = 0.0002 ratio, well under 0.01.
    writeSolidPng(baselineFile(cfg), 100, 100, WHITE);
    writeNoisyPng(currentFile(cfg), 100, 100, WHITE, 2);

    const result = await diffTemplate(TEMPLATE, VIEWPORT, cfg, RUN_ID);

    expect(result.diffPixelRatio).toBeLessThan(0.01);
    expect(result.findings).toHaveLength(0);
    expect(result.diffPath).toBeNull();
  });

  test('baseline missing → baseline-missing finding, no throw', async () => {
    const cfg = freshDirs();
    // Only the current shot exists; no baseline written.
    writeSolidPng(currentFile(cfg), 100, 100, WHITE);

    const result = await diffTemplate(TEMPLATE, VIEWPORT, cfg, RUN_ID);

    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.ruleId).toBe('visual-regression:baseline-missing');
    expect(f.severity).toBe('medium');
    expect(f.confidence).toBe(1.0);
    expect(result.diffPath).toBeNull();
  });

  test('dimension mismatch → template-changed finding with ratio 1, no throw', async () => {
    const cfg = freshDirs();
    writeSolidPng(baselineFile(cfg), 100, 100, WHITE);
    writeSolidPng(currentFile(cfg), 100, 120, WHITE); // taller current

    const result = await diffTemplate(TEMPLATE, VIEWPORT, cfg, RUN_ID);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleId).toBe('visual-regression:template-changed');
    expect(result.diffPixelRatio).toBe(1);
    expect(result.findings[0].meta?.dimensionNote).toBeTruthy();
  });
});
