import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ScoredBug } from '../types.js';
import type { Finding } from '../types/finding.js';

const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');
const CROPS_DIR = join(process.cwd(), 'output', 'crops');
const DISPLAY_WIDTH = 700;
const CROP_HEIGHT = 350;

export function urlToSlug(url: string): string {
  return url.replace(/https?:\/\/[^/]+/, '').replace(/\//g, '-').slice(0, 60) || 'root';
}

export function findFullPageShot(urls: string[], dir = SCREENSHOTS_DIR): { path: string; viewport: string } | null {
  for (const url of urls.slice(0, 3)) {
    for (const vp of ['desktop', 'tablet', 'mobile']) {
      const p = join(dir, `${urlToSlug(url)}-${vp}.png`);
      if (existsSync(p)) return { path: p, viewport: vp };
    }
  }
  return null;
}

export interface CroppedScreenshot {
  dataUri: string;
  viewport: string;
  tier: 'element' | 'crop' | 'full';
}

export async function getCroppedScreenshot(bug: ScoredBug): Promise<CroppedScreenshot | null> {
  // Tier 1 (preferred): tight, bounding-box-overlaid element crop captured at
  // check time by src/crops (worktree H). Element-level checks populate
  // BugInstance.elementScreenshot → BugRecord.elementShot. Tiers 2/3 below are
  // now fallbacks for findings without an element crop and should rarely fire.
  if (bug.elementShot && existsSync(bug.elementShot)) {
    try {
      const buf = await sharp(bug.elementShot)
        .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
        .png()
        .toBuffer();
      return {
        dataUri: `data:image/png;base64,${buf.toString('base64')}`,
        viewport: bug.viewports[0] ?? 'desktop',
        tier: 'element',
      };
    } catch { /* fall through */ }
  }

  // Tier 2: crop top portion of full-page screenshot
  const found = findFullPageShot(bug.urls);
  if (found) {
    try {
      const meta = await sharp(found.path).metadata();
      const cropH = Math.min(CROP_HEIGHT, meta.height ?? CROP_HEIGHT);
      const buf = await sharp(found.path)
        .extract({ left: 0, top: 0, width: meta.width ?? 1440, height: cropH })
        .resize({ width: DISPLAY_WIDTH })
        .png()
        .toBuffer();
      return { dataUri: `data:image/png;base64,${buf.toString('base64')}`, viewport: found.viewport, tier: 'crop' };
    } catch { /* fall through */ }

    // Tier 3: full page resized
    try {
      const buf = await sharp(found.path)
        .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
        .png()
        .toBuffer();
      return { dataUri: `data:image/png;base64,${buf.toString('base64')}`, viewport: found.viewport, tier: 'full' };
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * Sibling of {@link getCroppedScreenshot} for the v2 {@link Finding} stream.
 *
 * Findings carry their evidence directly (worktree H + I populate `crop.path`),
 * so this resolves the crop from the finding itself rather than guessing a
 * full-page shot by URL slug. Resolution order:
 *
 *  1. `crop.path` — relative to `output/crops/` per the Finding contract — used
 *     as the tight element crop (tier 'element'). This is the reviewer-preferred
 *     artifact and bypasses the legacy `findFullPageShot` lookup entirely.
 *  2. `fullPageScreenshotPath` — an absolute debug shot (tier 'full').
 *  3. null — the finding carries no displayable evidence.
 *
 * @param cropsDir base directory for relative `crop.path` values; override in tests.
 */
export async function getCroppedScreenshotForFinding(
  finding: Finding,
  cropsDir = CROPS_DIR,
): Promise<CroppedScreenshot | null> {
  const viewport = finding.viewport ?? 'desktop';

  if (finding.crop?.path) {
    const cropPath = isAbsolute(finding.crop.path) ? finding.crop.path : join(cropsDir, finding.crop.path);
    if (existsSync(cropPath)) {
      try {
        const buf = await sharp(cropPath)
          .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
          .png()
          .toBuffer();
        return { dataUri: `data:image/png;base64,${buf.toString('base64')}`, viewport, tier: 'element' };
      } catch { /* fall through to full-page fallback */ }
    }
  }

  if (finding.fullPageScreenshotPath && existsSync(finding.fullPageScreenshotPath)) {
    try {
      const buf = await sharp(finding.fullPageScreenshotPath)
        .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
        .png()
        .toBuffer();
      return { dataUri: `data:image/png;base64,${buf.toString('base64')}`, viewport, tier: 'full' };
    } catch { /* fall through */ }
  }

  return null;
}
