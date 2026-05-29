/**
 * Pixel-diff a current-run screenshot against its baseline and emit Findings.
 *
 * Uses pixelmatch (a Playwright transitive dep, pinned here as a direct dep)
 * and pngjs. Findings follow the canonical contract in src/types/finding.ts.
 *
 * Severity is pinned at 'medium' by design: per the check-author guide, visual
 * diffs are noisy and the visual-regression source has a 'medium' severity
 * floor — the rubric/scoring layer escalates when a diff turns out to matter.
 * Findings are emitted with `uncertain: true` so they route to the uncertain
 * report tier rather than the main report.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Finding, Viewport } from '../types/finding.js';
import { getTemplate } from './templates.js';

export interface DiffConfig {
  baselineDir: string;
  currentDir: string;
  /** Tolerance for diff before firing. */
  maxDiffPixelRatio?: number; // default 0.01
  threshold?: number; // pixelmatch threshold, default 0.2
}

export interface DiffResult {
  template: string;
  viewport: string;
  diffPath: string | null; // path to written diff image, null if no diff
  diffPixelRatio: number;
  findings: Finding[];
}

const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.01;
const DEFAULT_THRESHOLD = 0.2;

/** Visual-regression findings opt out of the legacy visual gate — the diff IS
 *  the gate (per docs/check-author-guide.md). */
const GATE_OPT_OUT = {
  verdict: 'visible' as const,
  reason: 'pre-confirmed by visual-regression diff',
  judgeModel: 'n/a',
};

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

function findingId(runId: string, fingerprint: string): string {
  return `f-${runId}-${fingerprint.slice(0, 8)}`;
}

/** Resolve the representative URL for a template id, or '' if unknown. */
function templateUrl(templateId: string): string {
  return getTemplate(templateId)?.representativeUrl ?? '';
}

/**
 * Compare one (template, viewport) pair. Never throws on a missing baseline or
 * a dimension mismatch — both are surfaced as findings instead.
 */
export async function diffTemplate(
  template: string,
  viewport: string,
  config: DiffConfig,
  runId: string,
): Promise<DiffResult> {
  const maxDiffPixelRatio = config.maxDiffPixelRatio ?? DEFAULT_MAX_DIFF_PIXEL_RATIO;
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const fileName = `${template}-${viewport}.png`;
  const baselinePath = join(config.baselineDir, fileName);
  const currentPath = join(config.currentDir, fileName);
  const discoveredAt = new Date().toISOString();
  const url = templateUrl(template);

  // Baseline missing → surface, don't fail. The team captures baselines with
  // scripts/baseline-update.ts; a missing one means "no baseline yet".
  if (!existsSync(baselinePath)) {
    const fingerprint = sha1(`visual-regression:baseline-missing:${template}:${viewport}`);
    const finding: Finding = {
      id: findingId(runId, fingerprint),
      fingerprint,
      runId,
      discoveredAt,
      ruleId: 'visual-regression:baseline-missing',
      category: 'visual-regression',
      source: 'visual-regression',
      severity: 'medium',
      url,
      viewport: viewport as Viewport,
      title: `No visual baseline for ${template} at ${viewport}`,
      description:
        `No baseline image exists at ${baselinePath}. Capture one with ` +
        `\`npx tsx scripts/baseline-update.ts ${template}\` after visually ` +
        `confirming the page renders correctly.`,
      confidence: 1.0,
      visualGate: GATE_OPT_OUT,
      meta: { template, viewport, baselinePath },
    };
    return { template, viewport, diffPath: null, diffPixelRatio: 0, findings: [finding] };
  }

  // Current screenshot missing → capture didn't run for this pair. Surface it
  // the same way rather than throwing.
  if (!existsSync(currentPath)) {
    const fingerprint = sha1(`visual-regression:current-missing:${template}:${viewport}`);
    const finding: Finding = {
      id: findingId(runId, fingerprint),
      fingerprint,
      runId,
      discoveredAt,
      ruleId: 'visual-regression:current-missing',
      category: 'visual-regression',
      source: 'visual-regression',
      severity: 'medium',
      url,
      viewport: viewport as Viewport,
      title: `No current screenshot for ${template} at ${viewport}`,
      description: `Expected a current-run screenshot at ${currentPath} but none was captured.`,
      confidence: 1.0,
      visualGate: GATE_OPT_OUT,
      meta: { template, viewport, currentPath },
    };
    return { template, viewport, diffPath: null, diffPixelRatio: 0, findings: [finding] };
  }

  const baseline = PNG.sync.read(readFileSync(baselinePath));
  const current = PNG.sync.read(readFileSync(currentPath));

  const fingerprint = sha1(`visual-regression:${template}:${viewport}`);

  // Dimension mismatch IS a visual regression (the page got taller/shorter or a
  // viewport changed). pixelmatch requires equal dimensions, so we short-circuit
  // to a full-diff finding rather than letting it throw.
  if (baseline.width !== current.width || baseline.height !== current.height) {
    const finding = buildChangedFinding({
      template,
      viewport,
      runId,
      discoveredAt,
      url,
      fingerprint,
      diffPixelRatio: 1,
      baselinePath,
      currentPath,
      diffPath: null,
      dimensionNote:
        `baseline ${baseline.width}×${baseline.height} vs current ` +
        `${current.width}×${current.height}`,
    });
    return { template, viewport, diffPath: null, diffPixelRatio: 1, findings: [finding] };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, {
    threshold,
  });
  const diffPixelRatio = width * height === 0 ? 0 : diffPixels / (width * height);

  if (diffPixelRatio <= maxDiffPixelRatio) {
    return { template, viewport, diffPath: null, diffPixelRatio, findings: [] };
  }

  const diffPath = join(config.currentDir, `${template}-${viewport}.diff.png`);
  writeFileSync(diffPath, PNG.sync.write(diff));

  const finding = buildChangedFinding({
    template,
    viewport,
    runId,
    discoveredAt,
    url,
    fingerprint,
    diffPixelRatio,
    baselinePath,
    currentPath,
    diffPath,
  });

  return { template, viewport, diffPath, diffPixelRatio, findings: [finding] };
}

function buildChangedFinding(args: {
  template: string;
  viewport: string;
  runId: string;
  discoveredAt: string;
  url: string;
  fingerprint: string;
  diffPixelRatio: number;
  baselinePath: string;
  currentPath: string;
  diffPath: string | null;
  dimensionNote?: string;
}): Finding {
  const pct = (args.diffPixelRatio * 100).toFixed(2);
  const description =
    `${pct}% of pixels differ from the baseline.` +
    (args.dimensionNote ? ` Dimensions changed: ${args.dimensionNote}.` : '') +
    ` Baseline: ${args.baselinePath}. Current: ${args.currentPath}.` +
    (args.diffPath ? ` Diff: ${args.diffPath}.` : '');

  const meta: Record<string, string | number | boolean | null> = {
    diffPixelRatio: args.diffPixelRatio,
    baselinePath: args.baselinePath,
    currentPath: args.currentPath,
    diffPath: args.diffPath,
  };
  if (args.dimensionNote) meta.dimensionNote = args.dimensionNote;

  return {
    id: findingId(args.runId, args.fingerprint),
    fingerprint: args.fingerprint,
    runId: args.runId,
    discoveredAt: args.discoveredAt,
    ruleId: 'visual-regression:template-changed',
    category: 'visual-regression',
    source: 'visual-regression',
    severity: 'medium', // diffs are noisy; the rubric/scoring layer escalates
    url: args.url,
    viewport: args.viewport as Viewport,
    title: `Visual regression on ${args.template} at ${args.viewport}`,
    description,
    confidence: 0.5, // the diff is real; whether it's meaningful is uncertain
    uncertain: true, // route to the uncertain tier by default
    visualGate: GATE_OPT_OUT,
    meta,
  };
}
