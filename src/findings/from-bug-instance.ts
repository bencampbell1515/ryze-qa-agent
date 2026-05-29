import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync } from 'node:fs';
import type { Finding, ElementRef } from '../types/finding.js';

/**
 * Build a canonical Finding from the data a check has on hand at emit time.
 * Designed to be called from check sites alongside BugCollector.add(): the
 * check supplies the typed inputs; this function fills in fingerprint, id,
 * runId stamping, source, and timestamp.
 *
 * This is the FORWARD path: checks build Findings as the richer record. In
 * worktree M the existing BugInstance is still emitted independently (the
 * bugs.add call site is left untouched), so this never feeds bugs.jsonl during
 * M — but {@link toBugInstance} can derive a BugInstance from the result for
 * future worktrees and for the disabled checks if they are ever re-enabled.
 */
export interface BuildFindingInput {
  runId: string;
  url: string;
  /** "category:slug", e.g. "revenue:cart-subtotal-missing". */
  ruleId: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  /** Defaults to 0.9 for deterministic checks. */
  confidence?: number;
  /** Omit if the finding points at no DOM element. */
  element?: ElementRef;
  /** Path written by captureBugCrop (worktree H). PNG dimensions are read from
   *  the file synchronously. */
  cropPath?: string;
  /** Legacy BugInstance.selector; folded into element.selector when no element
   *  is supplied. */
  selector?: string;
  /** Legacy BugInstance.outerHTMLSnippet; goes into meta.outerHtmlSnippet. */
  outerHtmlSnippet?: string;
  /** Legacy BugInstance.pageScreenshot; goes into fullPageScreenshotPath. */
  pageScreenshotPath?: string;
  viewport?: 'desktop' | 'tablet' | 'mobile';
  /** The check's original v1 BugInstance.bugClass, when it has no clean v2
   *  category equivalent (e.g. a 'security'-prefixed ruleId, or a re-enabled
   *  'lighthouse' check). Stored in meta.legacyBugClass so toBugInstance can
   *  round-trip it exactly. Omit when category maps cleanly. */
  legacyBugClass?: string;
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * The v1 captureBugCrop path always crops with a 16px pad and draws the box
 * (see src/crops/capture.ts DEFAULT_PADDING / drawBoundingBox default). The
 * crop file on disk carries no record of those settings, so we stamp the known
 * v1 defaults when reconstructing the ElementCrop from a cropPath.
 */
const V1_CROP_PADDING = 16;
const V1_CROP_BOX_DRAWN = true;

/**
 * Stable fingerprint per docs/check-author-guide.md, identical in formula to
 * tests/journeys/_helpers.ts `journeyFingerprint` so a finding reported by a
 * page check and the same issue seen by a journey fingerprint-match:
 *
 *   sha1(ruleId + ":" + url + ":" + role + ":" + name)
 *
 * Uses the accessible name (role + name), NOT the selector — selectors change
 * with theme updates; role + name are stable. With no element the signature is
 * empty (":") so the fingerprint reduces to the ruleId + url pair.
 */
function computeFindingFingerprint(ruleId: string, url: string, element?: ElementRef): string {
  const signature = `${element?.role ?? ''}:${element?.name ?? ''}`;
  return createHash('sha1').update(`${ruleId}:${url}:${signature}`).digest('hex');
}

/**
 * Read width/height from a PNG header synchronously (IHDR is the first chunk).
 * PNG layout: 8-byte signature, then length(4)+"IHDR"(4)+width(4)+height(4) —
 * width at byte 16, height at byte 20, both big-endian uint32. Returns null if
 * the file can't be read or isn't a PNG, so buildFinding degrades gracefully.
 */
function pngDimensions(path: string): { width: number; height: number } | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(24);
    const read = readSync(fd, buf, 0, 24, 0);
    if (read < 24) return null;
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function buildFinding(input: BuildFindingInput): Finding {
  // Element: prefer the explicit ElementRef; otherwise lift a bare selector into one.
  let element: ElementRef | undefined = input.element;
  if (!element && input.selector) {
    element = { selector: input.selector };
  } else if (element && !element.selector && input.selector) {
    element = { ...element, selector: input.selector };
  }

  const fingerprint = computeFindingFingerprint(input.ruleId, input.url, element);
  const id = `f-${input.runId}-${fingerprint.slice(0, 8)}`;

  // meta: merge caller meta with the legacy outerHtmlSnippet; emit nothing if empty.
  const meta: Record<string, string | number | boolean | null> = { ...(input.meta ?? {}) };
  if (input.outerHtmlSnippet !== undefined) meta.outerHtmlSnippet = input.outerHtmlSnippet;
  if (input.legacyBugClass !== undefined) meta.legacyBugClass = input.legacyBugClass;
  const hasMeta = Object.keys(meta).length > 0;

  const finding: Finding = {
    id,
    fingerprint,
    runId: input.runId,
    discoveredAt: new Date().toISOString(),
    ruleId: input.ruleId,
    category: input.category,
    source: 'deterministic', // all v1 page checks are deterministic
    severity: input.severity,
    url: input.url,
    title: input.title,
    description: input.description,
    confidence: input.confidence ?? 0.9,
    // visualGate intentionally left undefined: let the legacy gate run as today.
  };

  if (element) finding.element = element;
  if (input.viewport) finding.viewport = input.viewport;
  if (input.pageScreenshotPath) finding.fullPageScreenshotPath = input.pageScreenshotPath;
  if (hasMeta) finding.meta = meta;

  if (input.cropPath) {
    const dims = pngDimensions(input.cropPath);
    finding.crop = {
      path: input.cropPath,
      width: dims?.width ?? 0,
      height: dims?.height ?? 0,
      padding: V1_CROP_PADDING,
      boundingBoxDrawn: V1_CROP_BOX_DRAWN,
    };
  }

  return finding;
}
