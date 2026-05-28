/**
 * Deterministic content rules (worktree D).
 *
 * Three cheap, LLM-free checks that compare page content against the canonical
 * record in config/canonical-record.json:
 *
 *   1. checkCopyrightYear  — stale "© 2025" when the current year has moved on
 *   2. checkBrandTerms     — near-miss spellings of canonical brand/product terms
 *   3. checkUrlTypos       — relative <a href> paths that fat-finger a brand term
 *                            (e.g. /pages/brandambassdor → brandambassador)
 *
 * All three are driven by the canonical record and use edit-distance, not an
 * LLM. See docs/check-author-guide.md for the Finding contract and tests/
 * cross-page/content-rules.test.ts for the behavioural spec.
 */

import { createHash } from 'node:crypto';
import { distance } from 'fastest-levenshtein';
import type { CanonicalRecord, Finding } from '../types/finding.js';

const CATEGORY = 'content';
const SOURCE = 'cross-page' as const;

/** Minimum canonical-term length required for an edit-distance match to fire.
 *  Short terms produce too many false positives, so distance-2 needs a longer
 *  term than distance-1. (Brief defaults.) */
const MIN_LEN_DISTANCE_1 = 6;
const MIN_LEN_DISTANCE_2 = 8;

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

function makeId(runId: string, fingerprint: string): string {
  return `f-${runId}-${fingerprint.slice(0, 8)}`;
}

/**
 * Is `candidate` a near-miss of canonical `term`?
 * Exact (case-insensitive) matches are NOT near-misses — they are correct usage.
 * The length floor is based on the canonical term's length.
 */
function nearMatchDistance(candidate: string, term: string): number | null {
  const a = candidate.toLowerCase();
  const b = term.toLowerCase();
  if (a === b) return null; // correct usage
  const d = distance(a, b);
  if (d === 1 && b.length >= MIN_LEN_DISTANCE_1) return 1;
  if (d === 2 && b.length >= MIN_LEN_DISTANCE_2) return 2;
  return null;
}

// ---------------------------------------------------------------------------
// 1. Copyright year freshness
// ---------------------------------------------------------------------------

const COPYRIGHT_RE = /(?:©|copyright|&copy;)\s*(\d{4})(?:\s*[–-]\s*(\d{4}))?/gi;

export async function checkCopyrightYear(
  url: string,
  pageText: string,
  canonical: CanonicalRecord,
  runId: string
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const acceptable = canonical.acceptableCopyrightYears;

  for (const match of pageText.matchAll(COPYRIGHT_RE)) {
    const year1 = Number(match[1]);
    const year2 = match[2] ? Number(match[2]) : undefined;
    // "Most-recent year mentioned" = the max of the matched years. This handles
    // both normal ranges ("2020-2024" → 2024) and reversed ones ("2025-2024" → 2025).
    const detectedYear = year2 !== undefined ? Math.max(year1, year2) : year1;

    if (acceptable.includes(detectedYear)) continue;

    const fingerprint = sha1(`content:outdated-copyright:${url}:${detectedYear}`);
    if (seen.has(fingerprint)) continue; // dedup multiple lines on one page
    seen.add(fingerprint);

    findings.push({
      id: makeId(runId, fingerprint),
      fingerprint,
      runId,
      discoveredAt: new Date().toISOString(),
      ruleId: 'content:outdated-copyright',
      category: CATEGORY,
      source: SOURCE,
      severity: 'medium',
      url,
      title: `Outdated copyright year: ©${detectedYear} on ${url}`,
      description:
        `Copyright statement shows ${detectedYear}; current acceptable years are ` +
        `${acceptable.join(', ')}.`,
      remediation: `Update the copyright statement to ${Math.max(...acceptable)}.`,
      confidence: 1.0,
      // Footer copyright text is always rendered; pre-confirm to skip the visual gate.
      visualGate: { verdict: 'visible', reason: 'pre-confirmed by check', judgeModel: 'n/a' },
      meta: { detectedYear, acceptableYears: acceptable.join(',') },
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 2. Brand-term / product-name dictionary check
// ---------------------------------------------------------------------------

/** Tokenize visible text into word runs, stripping surrounding punctuation. */
function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

export async function checkBrandTerms(
  url: string,
  pageText: string,
  canonical: CanonicalRecord,
  runId: string
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const variantSet = new Set(canonical.brandVariants.map((v) => v.toLowerCase()));
  const termSet = new Set(canonical.brandTerms.map((t) => t.toLowerCase()));
  const tokens = tokenize(pageText);

  for (const term of canonical.brandTerms) {
    const wordCount = term.trim().split(/\s+/).length;

    for (let i = 0; i + wordCount <= tokens.length; i++) {
      const phrase = tokens.slice(i, i + wordCount).join(' ');
      const lower = phrase.toLowerCase();

      // Skip correct usage: exact match to any canonical term or known variant.
      if (termSet.has(lower) || variantSet.has(lower)) continue;

      const dist = nearMatchDistance(phrase, term);
      if (dist === null) continue;

      const fingerprint = sha1(`content:brand-term-typo:${url}:${phrase}:${term}`);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      const idx = pageText.toLowerCase().indexOf(lower);
      const context =
        idx >= 0
          ? pageText.slice(Math.max(0, idx - 80), idx + phrase.length + 80).replace(/\s+/g, ' ').trim()
          : phrase;

      const confidence = 0.6;
      findings.push({
        id: makeId(runId, fingerprint),
        fingerprint,
        runId,
        discoveredAt: new Date().toISOString(),
        ruleId: 'content:brand-term-typo',
        category: CATEGORY,
        source: SOURCE,
        severity: 'medium',
        url,
        title: `Possible brand-term typo: '${phrase}' vs '${term}'`,
        description:
          `Found '${phrase}' (edit distance ${dist} from canonical '${term}'). ` +
          `Context: "…${context}…"`,
        confidence,
        uncertain: confidence < 0.7,
        meta: { foundTerm: phrase, canonicalTerm: term, editDistance: dist },
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 3. URL typo detection
// ---------------------------------------------------------------------------

const HREF_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;

/** A host is first-party if it is the page's own host or any RYZE host. */
function isFirstPartyHost(host: string, pageHost: string): boolean {
  const h = host.toLowerCase();
  return h === pageHost.toLowerCase() || h === 'ryzesuperfoods.com' || h.endsWith('.ryzesuperfoods.com');
}

/**
 * Resolve an href to an origin-relative path (path + query + hash) if it is
 * in scope, else null. In scope = root-relative paths AND absolute URLs that
 * point at a first-party host. "External" means a *different* host, not merely
 * "has a scheme" — the real-world typo link is written as an absolute
 * same-origin URL, so a scheme alone must not exclude it.
 */
function inScopePath(href: string, pageUrl: string): string | null {
  const h = href.trim();
  if (!h || h.startsWith('#')) return null;

  // Non-navigational schemes are always out of scope.
  if (/^(mailto|tel|javascript|data|sms|ftp):/i.test(h)) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(h);
  const protocolRelative = h.startsWith('//');

  if (hasScheme || protocolRelative) {
    let pageHost: string;
    try {
      pageHost = new URL(pageUrl).host;
    } catch {
      pageHost = '';
    }
    try {
      const u = new URL(protocolRelative ? `https:${h}` : h);
      if (!isFirstPartyHost(u.host, pageHost)) return null; // genuinely external
      return u.pathname + u.search + u.hash;
    } catch {
      return null;
    }
  }

  // Root-relative path. (Bare relative paths like "foo/bar" are skipped to
  // avoid ambiguity / noise.)
  return h.startsWith('/') ? h : null;
}

/** Extract path segments from an origin-relative path, dropping query/hash. */
function pathSegments(path: string): string[] {
  return path.split('#')[0].split('?')[0]
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .filter(Boolean);
}

export async function checkUrlTypos(
  url: string,
  pageHtml: string,
  canonical: CanonicalRecord,
  runId: string,
  /** Optional cross-page registry, keyed by fingerprint. Pass the same Map
   *  across pages to collapse one typo'd URL seen on many pages into a single
   *  finding (with the extra pages recorded in relatedUrls / meta.alsoFoundOn).
   *  Newly-created findings are returned; repeat sightings mutate the existing
   *  finding in place and return nothing. */
  registry?: Map<string, Finding>
): Promise<Finding[]> {
  const created: Finding[] = [];
  const reg = registry ?? new Map<string, Finding>();
  const termSet = new Set(canonical.brandTerms.map((t) => t.toLowerCase()));

  for (const match of pageHtml.matchAll(HREF_RE)) {
    const relPath = inScopePath(match[1], url);
    if (relPath === null) continue;

    const badPath = relPath.split('#')[0].split('?')[0];

    for (const rawSegment of pathSegments(relPath)) {
      // URL segments hyphenate multi-word terms; normalize for comparison.
      const segment = rawSegment.replace(/[-_]+/g, ' ').toLowerCase();
      if (termSet.has(segment)) continue; // correct usage

      let bestTerm: string | null = null;
      let bestDist = Infinity;
      for (const term of canonical.brandTerms) {
        const dist = nearMatchDistance(segment, term);
        if (dist !== null && dist < bestDist) {
          bestDist = dist;
          bestTerm = term;
        }
      }
      if (!bestTerm) continue;

      const fingerprint = sha1(`content:url-typo:${badPath}:${bestTerm}`);

      const existing = reg.get(fingerprint);
      if (existing) {
        if (existing.url !== url && !(existing.relatedUrls ?? []).includes(url)) {
          existing.relatedUrls = [...(existing.relatedUrls ?? []), url];
          const prior = existing.meta?.alsoFoundOn ? String(existing.meta.alsoFoundOn) : '';
          existing.meta = {
            ...existing.meta,
            alsoFoundOn: prior ? `${prior},${url}` : url,
          };
        }
        continue;
      }

      const finding: Finding = {
        id: makeId(runId, fingerprint),
        fingerprint,
        runId,
        discoveredAt: new Date().toISOString(),
        ruleId: 'content:url-typo',
        category: CATEGORY,
        source: SOURCE,
        severity: 'high',
        url,
        title: `URL typo: ${badPath} (close to '${bestTerm}')`,
        description:
          `Relative link "${badPath}" contains the segment "${rawSegment}", an edit ` +
          `distance ${bestDist} from canonical brand term "${bestTerm}". Linked from ${url}. ` +
          `A typo'd URL risks a dead page or a duplicate of the correct one.`,
        confidence: 0.85,
        meta: { badPath, canonicalTerm: bestTerm, foundOnPage: url },
      };
      reg.set(fingerprint, finding);
      created.push(finding);
    }
  }

  return created;
}
