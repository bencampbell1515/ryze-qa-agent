/**
 * Thin orchestrator for template-level visual regression.
 *
 * Captures current-run screenshots for every template, diffs each against its
 * baseline, and returns aggregated Findings. When `isBaseline` is true it only
 * captures (writing/refreshing baselines) and returns no findings.
 *
 * Launches its own browser (system Chrome via Cloudflare O2O, matching the rest
 * of the suite). GCS-backed baselines are out of scope for this scaffold —
 * baselines live under a local `baselineDir`. Swapping to GCS later is a
 * config/path-adapter change, not a rewrite.
 */

import { chromium } from '@playwright/test';
import type { Finding } from '../types/finding.js';
import { TEMPLATES } from './templates.js';
import { captureTemplate, type CaptureConfig } from './capture.js';
import { diffTemplate, type DiffConfig } from './diff.js';

export type VisualRegressionConfig = CaptureConfig & DiffConfig;

export async function runVisualRegression(
  config: VisualRegressionConfig,
  runId: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    for (const template of TEMPLATES) {
      await captureTemplate(browser, template, config);

      if (config.isBaseline) {
        // Baseline mode: capture only, no diff, no findings.
        continue;
      }

      for (const viewport of template.viewports) {
        const result = await diffTemplate(
          template.id,
          viewport,
          // Diff against exactly what we just captured (outputDir), regardless
          // of any currentDir the caller passed.
          { ...config, currentDir: config.outputDir },
          runId,
        );
        findings.push(...result.findings);
      }
    }
  } finally {
    await browser.close();
  }

  return findings;
}
