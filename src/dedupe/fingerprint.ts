import { createHash } from 'node:crypto';
import type { BugInstance, BugRecord, Severity, BugClass, Viewport } from '../types.js';
import { hammingDistance } from './perceptual-hash.js';

const URL_PATTERN = /\/[a-zA-Z0-9_-]+-[a-f0-9]{8,}(\.[\w]+)?/g;
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/g;
const ID_SUFFIX_PATTERN = /-\d{4,}/g;

export function normalizeMessage(msg: string): string {
  return msg
    .replace(URL_PATTERN, '/*/')
    .replace(DATE_PATTERN, 'DATE')
    .replace(ID_SUFFIX_PATTERN, '-N')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeFingerprint(
  ruleId: string,
  message: string,
  sectionAnchor: string,
  dHashHex?: string,
): string {
  const normalized = normalizeMessage(message);
  const hashPart = dHashHex ? dHashHex.slice(0, 16) : 'nohash';
  const input = `${ruleId}|${normalized}|${sectionAnchor}|${hashPart}`;
  return createHash('sha1').update(input).digest('hex');
}

/** Determine whether two bug instances should merge. */
export function shouldMerge(
  a: BugInstance & { dHash?: string; sectionAnchor?: string },
  b: BugInstance & { dHash?: string; sectionAnchor?: string },
): boolean {
  const fpA = computeFingerprint(a.ruleId, a.message, a.sectionAnchor ?? 'document', a.dHash);
  const fpB = computeFingerprint(b.ruleId, b.message, b.sectionAnchor ?? 'document', b.dHash);
  if (fpA === fpB) return true;

  // Fuzzy: same rule+message, visually similar element
  if (
    a.ruleId === b.ruleId &&
    normalizeMessage(a.message) === normalizeMessage(b.message) &&
    a.dHash &&
    b.dHash &&
    hammingDistance(a.dHash, b.dHash) <= 4
  ) {
    return true;
  }
  return false;
}

/** Group BugInstances into deduplicated BugRecords. O(n) via fingerprint hash map. */
export function deduplicateBugs(
  instances: Array<BugInstance & { dHash?: string; sectionAnchor?: string }>,
): BugRecord[] {
  const fpMap = new Map<string, BugRecord>();

  for (const inst of instances) {
    const anchor = inst.sectionAnchor ?? 'document';
    const fp = computeFingerprint(inst.ruleId, inst.message, anchor, inst.dHash);

    const existing = fpMap.get(fp);
    if (existing) {
      if (!existing.urls.includes(inst.url)) existing.urls.push(inst.url);
      if (!existing.viewports.includes(inst.viewport)) existing.viewports.push(inst.viewport);
      existing.instanceCount++;
    } else {
      const record: BugRecord = {
        fingerprint: fp,
        ruleId: inst.ruleId,
        severity: inst.severity,
        bugClass: inst.bugClass,
        title: buildTitle(inst),
        description: inst.message,
        urls: [inst.url],
        viewports: [inst.viewport],
        elementShot: inst.elementScreenshot,
        annotatedPageShot: inst.pageScreenshot,
        selector: inst.selector,
        outerHTMLSnippet: inst.outerHTMLSnippet,
        helpUrl: inst.helpUrl,
        instanceCount: 1,
      };
      fpMap.set(fp, record);
    }
  }

  return Array.from(fpMap.values());
}

export function buildTitle(inst: BugInstance): string {
  const parts = inst.ruleId.split(':');
  const category = parts[0] ?? inst.ruleId;
  const detail = parts[1] ?? '';
  const normalized = normalizeMessage(inst.message);
  return `[${category.toUpperCase()}] ${detail} — ${normalized.slice(0, 80)}`;
}
