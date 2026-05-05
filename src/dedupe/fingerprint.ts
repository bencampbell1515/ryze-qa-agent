import { createHash } from 'node:crypto';
import type { BugInstance, BugRecord } from '../types.js';
import { hammingDistance } from './perceptual-hash.js';

// DEDUP-008: include uppercase A-F so CDN hash suffixes like /foo-A1B2C3D4 are normalized
const URL_PATTERN = /\/[a-zA-Z0-9_-]+-[a-fA-F0-9]{8,}(\.[\w]+)?/g;
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/g;
const ID_SUFFIX_PATTERN = /-\d{4,}/g;

/**
 * Normalize a bug message for fingerprinting.
 * DEDUP-005: For network:404 messages, strip only the host so that each broken
 * resource path remains distinct and 404s don't all collapse into one record.
 */
export function normalizeMessage(msg: string, ruleId?: string): string {
  let normalized = msg
    .replace(/ — Fix (?:any|all|one) of the following:[\s\S]*/i, '');

  if (ruleId === 'network:404') {
    // Keep the URL path so different broken resources produce different fingerprints
    normalized = normalized.replace(/https?:\/\/[^/\s,)'"]+/g, '');
  } else {
    normalized = normalized.replace(/https?:\/\/[^\s,)'"]+/g, 'URL');
  }

  return normalized
    .replace(URL_PATTERN, '/*/')
    .replace(DATE_PATTERN, 'DATE')
    .replace(ID_SUFFIX_PATTERN, '-N')
    .replace(/\b\d+\.\d+\b/g, 'N')
    .replace(/#[0-9a-fA-F]{3,8}\b/g, '#HEX')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute a stable SHA-1 fingerprint for a bug.
 * DEDUP-003: use the full 64-char binary dHash string, not a 16-char slice.
 */
export function computeFingerprint(
  ruleId: string,
  message: string,
  sectionAnchor: string,
  dHash?: string,
): string {
  const normalized = normalizeMessage(message, ruleId);
  // DEDUP-003: dHash is a 64-char binary string ('0'/'1'), use it in full
  const hashPart = dHash ? dHash : 'nohash';
  const input = `${ruleId}|${normalized}|${sectionAnchor}|${hashPart}`;
  return createHash('sha1').update(input).digest('hex');
}

/** Determine whether two bug instances should merge. */
export function shouldMerge(a: BugInstance, b: BugInstance): boolean {
  const fpA = computeFingerprint(a.ruleId, a.message, a.sectionAnchor ?? 'document', a.dHash);
  const fpB = computeFingerprint(b.ruleId, b.message, b.sectionAnchor ?? 'document', b.dHash);
  if (fpA === fpB) return true;

  // Fuzzy: same rule+message, visually similar element
  if (
    a.ruleId === b.ruleId &&
    normalizeMessage(a.message, a.ruleId) === normalizeMessage(b.message, b.ruleId) &&
    a.dHash &&
    b.dHash &&
    hammingDistance(a.dHash, b.dHash) <= 4
  ) {
    return true;
  }
  return false;
}

/** Group BugInstances into deduplicated BugRecords. */
export function deduplicateBugs(instances: BugInstance[]): BugRecord[] {
  // DEDUP-001: store representative instance alongside each record for fuzzy pass
  const fpMap = new Map<string, { record: BugRecord; rep: BugInstance }>();

  for (const inst of instances) {
    const anchor = inst.sectionAnchor ?? 'document';
    const fp = computeFingerprint(inst.ruleId, inst.message, anchor, inst.dHash);

    const existing = fpMap.get(fp);
    if (existing) {
      const rec = existing.record;
      if (!rec.urls.includes(inst.url)) rec.urls.push(inst.url);
      if (!rec.viewports.includes(inst.viewport)) rec.viewports.push(inst.viewport);
      rec.instanceCount++;
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
      fpMap.set(fp, { record, rep: inst });
    }
  }

  // DEDUP-001: fuzzy second pass — only check instances that have dHash set
  const entries = Array.from(fpMap.entries());
  const merged = new Set<string>(); // fingerprints already absorbed into another record

  for (let i = 0; i < entries.length; i++) {
    const [fpA, entA] = entries[i]!;
    if (merged.has(fpA)) continue;

    for (let j = i + 1; j < entries.length; j++) {
      const [fpB, entB] = entries[j]!;
      if (merged.has(fpB)) continue;

      // Only attempt fuzzy merge when both sides have a dHash
      if (!entA.rep.dHash || !entB.rep.dHash) continue;

      if (shouldMerge(entA.rep, entB.rep)) {
        // Merge the record with fewer instances into the one with more
        const [winner, loser, loserFp] =
          entA.record.instanceCount >= entB.record.instanceCount
            ? [entA.record, entB.record, fpB]
            : [entB.record, entA.record, fpA];

        for (const u of loser.urls) {
          if (!winner.urls.includes(u)) winner.urls.push(u);
        }
        for (const v of loser.viewports) {
          if (!winner.viewports.includes(v)) winner.viewports.push(v);
        }
        winner.instanceCount += loser.instanceCount;
        merged.add(loserFp);
      }
    }
  }

  return entries
    .filter(([fp]) => !merged.has(fp))
    .map(([, entry]) => entry.record);
}

export function buildTitle(inst: BugInstance): string {
  const parts = inst.ruleId.split(':');
  const category = parts[0] ?? inst.ruleId;
  const detail = parts[1] ?? '';
  const normalized = normalizeMessage(inst.message, inst.ruleId);
  return `[${category.toUpperCase()}] ${detail} — ${normalized.slice(0, 80)}`;
}
