/**
 * Screenshot capture for template-level visual regression.
 *
 * Captures one full-page screenshot per (template, viewport), with dynamic
 * regions masked so they don't poison the diff. Masking uses CSS
 * `visibility: hidden` rather than Playwright's solid-paint `mask` option,
 * because hiding (vs painting) preserves layout geometry — a masked countdown
 * timer still occupies its box, so the rest of the page doesn't reflow and
 * produce spurious diffs.
 *
 * Viewport sizes mirror playwright.config.ts so baselines line up with the
 * rest of the suite.
 */

import type { Browser } from '@playwright/test';
import type { Template } from './templates.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const USER_AGENT = 'RyzeQABot/0.1 (+pm@ryze.example)';

/** Always-applied settle time after networkidle, before capture. */
const DEFAULT_SETTLE_MS = 1000;

/**
 * Full-page screenshots taller than this many CSS px produce 40MB+ PNGs that
 * OOM-crash Chrome (same guard as tests/checks/visual.ts). Fall back to a
 * viewport-height capture for those pages.
 */
const MAX_FULLPAGE_HEIGHT_PX = 25_000;

interface ViewportSpec {
  width: number;
  height: number;
  isMobile?: boolean;
  hasTouch?: boolean;
}

/** Mirrors the projects in playwright.config.ts. */
const VIEWPORT_SIZES: Record<'desktop' | 'tablet' | 'mobile', ViewportSpec> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
};

export interface CaptureConfig {
  baselineDir: string; // local path, e.g. "./baselines"
  outputDir: string; // where current-run shots go, e.g. "./output/visual"
  isBaseline: boolean; // true to overwrite baseline, false to compare
}

export interface CaptureResult {
  template: string;
  viewport: string;
  path: string;
  /** True if this was a baseline write rather than a comparison. */
  baselineWritten: boolean;
}

/** Canonical on-disk file name for a (template, viewport) screenshot. */
export function shotFileName(templateId: string, viewport: string): string {
  return `${templateId}-${viewport}.png`;
}

/**
 * Capture every viewport for a single template.
 *
 * Writes baseline images to `baselineDir` when `config.isBaseline`, otherwise
 * writes current-run images to `outputDir`. Never diffs — diffing lives in
 * diff.ts so capture stays a pure side-effecting step.
 */
export async function captureTemplate(
  browser: Browser,
  template: Template,
  config: CaptureConfig,
): Promise<CaptureResult[]> {
  const results: CaptureResult[] = [];
  const targetDir = config.isBaseline ? config.baselineDir : config.outputDir;
  mkdirSync(targetDir, { recursive: true });

  for (const viewport of template.viewports) {
    const spec = VIEWPORT_SIZES[viewport];
    const context = await browser.newContext({
      viewport: { width: spec.width, height: spec.height },
      isMobile: spec.isMobile ?? false,
      hasTouch: spec.hasTouch ?? false,
      userAgent: USER_AGENT,
    });
    const page = await context.newPage();

    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });

      // networkidle can hang on sites that hold long-lived connections; tolerate
      // a timeout and fall through to the settle wait + lazy-load nudge.
      await page
        .goto(template.representativeUrl, { waitUntil: 'networkidle' })
        .catch(() => {});

      // Trigger Shopify's IntersectionObserver lazy-load (scroll down + back).
      // .catch on every waitForTimeout — Cloudflare may close long sessions.
      await page
        .evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        .catch(() => {});
      await page.waitForTimeout(DEFAULT_SETTLE_MS + (template.extraWaitMs ?? 0)).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

      // Hide dynamic regions so they don't poison the diff. visibility:hidden
      // keeps the box (no reflow) — see file header.
      if (template.maskSelectors.length > 0) {
        const css = `${template.maskSelectors.join(', ')} { visibility: hidden !important; }`;
        await page.addStyleTag({ content: css }).catch(() => {});
      }

      const scrollHeight = await page
        .evaluate(() => document.body.scrollHeight)
        .catch(() => 0);
      const useFullPage = scrollHeight > 0 && scrollHeight <= MAX_FULLPAGE_HEIGHT_PX;

      const outPath = join(targetDir, shotFileName(template.id, viewport));
      await page.screenshot({ path: outPath, fullPage: useFullPage });

      results.push({
        template: template.id,
        viewport,
        path: outPath,
        baselineWritten: config.isBaseline,
      });
    } finally {
      await context.close();
    }
  }

  return results;
}
