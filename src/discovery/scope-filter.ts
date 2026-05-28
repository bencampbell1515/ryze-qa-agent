/**
 * Scope filter for URL discovery (worktree A).
 *
 * Removes URLs that should never be audited (duplicated drafts, internal CRO
 * test variants, debug/admin routes, ad-link cart endpoints) before the audit
 * spends ~30-60s per page on pages no shopper ever sees. Every excluded URL
 * produces a HygieneFinding so the team can see exactly what was filtered and
 * which pattern matched.
 *
 * Pure and deterministic: no I/O, no async, no clock-dependent logic except the
 * `discoveredAt` timestamp on emitted findings (which callers must not assert
 * on for equality). See docs/check-author-guide.md and src/types/finding.ts.
 */

import { createHash } from 'node:crypto';
import type { HygieneFinding } from '../types/finding.js';

export interface ScopeFilterConfig {
  /** Substring patterns. A URL containing one is excluded. Prefix with `re:`
   *  to treat the remainder as a regular expression instead. */
  denyPatterns: string[];
  /** Exact URLs that always survive, even if they match a deny pattern. */
  allowOverrides: string[];
}

export interface ScopeFilterResult {
  /** URLs that survived the filter and should be audited. */
  audit: string[];
  /** One HygieneFinding per excluded URL. */
  hygiene: HygieneFinding[];
}

const RE_PREFIX = 're:';

/** Returns the pattern that excludes `url`, or undefined if none match. The
 *  first matching pattern (in config order) wins, so callers can list broad
 *  patterns first if they want them to be the attributed cause. */
function matchingPattern(url: string, denyPatterns: string[]): string | undefined {
  for (const pattern of denyPatterns) {
    if (pattern.startsWith(RE_PREFIX)) {
      const body = pattern.slice(RE_PREFIX.length);
      let re: RegExp;
      try {
        re = new RegExp(body);
      } catch {
        // A malformed regex pattern is a config error; skip it rather than
        // throwing, so one bad entry can't take down the whole crawl.
        continue;
      }
      if (re.test(url)) return pattern;
    } else if (url.includes(pattern)) {
      return pattern;
    }
  }
  return undefined;
}

function hygieneId(runId: string, reason: string, url: string): string {
  const shortHash = createHash('sha1').update(`${reason}:${url}`).digest('hex').slice(0, 8);
  return `h-${runId}-${shortHash}`;
}

export function applyScopeFilter(
  urls: string[],
  config: ScopeFilterConfig,
  runId: string,
): ScopeFilterResult {
  const allow = new Set(config.allowOverrides);
  const audit: string[] = [];
  const hygiene: HygieneFinding[] = [];
  const discoveredAt = new Date().toISOString();

  for (const url of urls) {
    if (allow.has(url)) {
      audit.push(url);
      continue;
    }
    const pattern = matchingPattern(url, config.denyPatterns);
    if (pattern === undefined) {
      audit.push(url);
      continue;
    }
    hygiene.push({
      id: hygieneId(runId, 'deny-list-match', url),
      runId,
      discoveredAt,
      reason: 'deny-list-match',
      url,
      detail: { pattern },
    });
  }

  return { audit, hygiene };
}
