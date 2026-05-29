import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { captureCrop } from './capture.js';
import type { CropConfig, CropTarget } from './types.js';

/**
 * Context for a v1 BugInstance crop. Used to build a stable, collision-free
 * output path under output/screenshots/crops/.
 */
export interface BugCropContext {
  /** The page URL the finding is on. */
  url: string;
  /** The finding's ruleId, e.g. "content:broken-image". */
  ruleId: string;
  /** Viewport label, e.g. "mobile". */
  viewport: string;
  /** Disambiguator when several findings share url+rule+viewport. Default 0. */
  seq?: number;
  /** Override the crops directory (defaults to output/screenshots/crops). */
  outputDir?: string;
}

const DEFAULT_CROPS_DIR = join(process.cwd(), 'output', 'screenshots', 'crops');

function urlSlug(url: string): string {
  return url.replace(/https?:\/\/[^/]+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'root';
}

function ruleSlug(ruleId: string): string {
  return ruleId.replace(/[^a-zA-Z0-9]+/g, '-');
}

/**
 * Capture a tight, bounding-box-overlaid element crop for a v1 BugInstance and
 * return its absolute path, or `null` if the element can't be cropped.
 *
 * Unlike {@link captureCrop}, this NEVER throws — an invisible/zero-area element
 * (ElementNotVisibleError) or any capture failure yields `null` so the calling
 * check just leaves `elementScreenshot` unset and the report falls through to
 * its other screenshot tiers. Checks run inside the live audit loop and must
 * not abort on a single un-croppable element.
 */
export async function captureBugCrop(
  page: Page,
  target: CropTarget,
  ctx: BugCropContext,
  config?: CropConfig,
): Promise<string | null> {
  const dir = ctx.outputDir ?? DEFAULT_CROPS_DIR;
  const file = `${urlSlug(ctx.url)}-${ctx.viewport}-${ruleSlug(ctx.ruleId)}-${ctx.seq ?? 0}.png`;
  const outputPath = join(dir, file);

  try {
    const crop = await captureCrop(page, target, outputPath, config);
    return crop.path;
  } catch {
    return null;
  }
}
