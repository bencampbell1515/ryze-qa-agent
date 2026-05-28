/**
 * Cross-page language detection: flag pages whose visible content doesn't match
 * the language implied by their URL.
 *
 * Motivation (from worktree-C brief): audits kept missing a whole class of
 * mixed-locale defects — `/es/fbo/mushroom-coffee` pages rendering English
 * titles, `/fr/pages/...-espanol` pages whose path says French but whose body
 * is Spanish, `/pages/mushroom-*-espanol` pages with significant English copy.
 * A page-isolated, text-blind check can't see these; a block-level language
 * detector with an expected-locale map catches them all cheaply and with no
 * LLM tokens (per docs/check-author-guide.md: cross-page layers must not call
 * LLMs in the hot path).
 *
 * Detection is done by `eld` (Efficient Language Detector) — pure JS, no native
 * bindings, no Python. We import the static `eld/medium` database so detection
 * is synchronous and needs no runtime `load()` call.
 */

import { createHash } from 'node:crypto';
import { eld } from 'eld/medium';
import type { Finding } from '../types/finding.js';

export interface LanguageCheckConfig {
  /** Locale to URL path prefix map. From config/canonical-record.json
   *  localePathPrefixes, e.g. { es: '/es/', fr: '/fr/' }. */
  localePathPrefixes: Record<string, string>;
  /** Mixed-content threshold. If the share of blocks whose detected language
   *  doesn't match the expected language exceeds this, emit a finding.
   *  Default 0.15 (15%). */
  mixedThreshold?: number;
  /** Minimum confidence to count a block as confidently detected. Default 0.6. */
  minBlockConfidence?: number;
  /** Minimum characters per block to bother detecting. Default 20. */
  minBlockLength?: number;
  /** Optional, additive extension to the brief. Language → slug substrings
   *  that imply a locale when NO path prefix matches. Needed because the known-
   *  bad `/pages/mushroom-*-espanol` pages carry no `/es/` prefix yet are
   *  Spanish by intent. Defaults to {@link DEFAULT_SLUG_MARKERS}. */
  localeSlugMarkers?: Record<string, string[]>;
}

export interface LanguageCheckResult {
  /** null if URL doesn't imply a locale (page is skipped). */
  expectedLanguage: string | null;
  /** Detected language code → count of confidently-detected blocks. */
  detectedLanguages: Record<string, number>;
  mixedBlockRatio: number;
  findings: Finding[];
}

const DEFAULT_MIXED_THRESHOLD = 0.15;
const DEFAULT_MIN_BLOCK_CONFIDENCE = 0.6;
const DEFAULT_MIN_BLOCK_LENGTH = 20;

/** Slug markers that imply a locale when the path carries no locale prefix. */
const DEFAULT_SLUG_MARKERS: Record<string, string[]> = {
  es: ['espanol', 'español'],
  fr: ['francais', 'français'],
};

const RULE_ID = 'i18n:mixed-locale-content';
const EXAMPLE_TRUNCATE = 90;

interface BlockDetection {
  text: string;
  language: string; // '' when eld can't decide
  confidence: number;
}

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

function parsePathname(url: string): string | null {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Derive the language a URL claims to be. Path prefix wins over slug marker:
 * `/fr/pages/x-espanol` is "claimed French" (the bug being that its content is
 * Spanish), so the prefix is authoritative for the expected locale.
 */
export function deriveExpectedLanguage(
  url: string,
  prefixes: Record<string, string>,
  slugMarkers: Record<string, string[]>,
): string | null {
  const pathname = parsePathname(url);
  if (pathname === null) return null;

  for (const [lang, prefix] of Object.entries(prefixes)) {
    if (prefix && pathname.startsWith(prefix.toLowerCase())) return lang;
  }
  for (const [lang, markers] of Object.entries(slugMarkers)) {
    if (markers.some((m) => pathname.includes(m.toLowerCase()))) return lang;
  }
  return null;
}

/** Replace the expected-locale path prefix with the dominant-locale prefix so
 *  reviewers get a link to where the correctly-localised page would live. */
function buildCorrectLocaleUrl(
  url: string,
  expectedPrefix: string | undefined,
  dominantPrefix: string | undefined,
): string | null {
  if (!expectedPrefix || !dominantPrefix) return null;
  try {
    const u = new URL(url);
    if (!u.pathname.toLowerCase().startsWith(expectedPrefix.toLowerCase())) return null;
    u.pathname = dominantPrefix + u.pathname.slice(expectedPrefix.length);
    return u.toString();
  } catch {
    return null;
  }
}

function detectBlocks(pageText: string, minBlockLength: number): BlockDetection[] {
  return pageText
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length >= minBlockLength)
    .map((text) => {
      const result = eld.detect(text);
      const language = result.language || '';
      const confidence = language ? result.getScores()[language] ?? 0 : 0;
      return { text, language, confidence };
    });
}

export async function checkPageLanguage(
  url: string,
  pageText: string,
  config: LanguageCheckConfig,
  runId: string,
): Promise<LanguageCheckResult> {
  const mixedThreshold = config.mixedThreshold ?? DEFAULT_MIXED_THRESHOLD;
  const minBlockConfidence = config.minBlockConfidence ?? DEFAULT_MIN_BLOCK_CONFIDENCE;
  const minBlockLength = config.minBlockLength ?? DEFAULT_MIN_BLOCK_LENGTH;
  const slugMarkers = config.localeSlugMarkers ?? DEFAULT_SLUG_MARKERS;

  const expectedLanguage = deriveExpectedLanguage(url, config.localePathPrefixes, slugMarkers);

  // URL doesn't imply a locale → out of scope, skip the page entirely.
  if (expectedLanguage === null) {
    return { expectedLanguage: null, detectedLanguages: {}, mixedBlockRatio: 0, findings: [] };
  }

  const blocks = detectBlocks(pageText, minBlockLength);
  const totalBlocks = blocks.length;

  const detectedLanguages: Record<string, number> = {};
  for (const b of blocks) {
    if (b.language && b.confidence >= minBlockConfidence) {
      detectedLanguages[b.language] = (detectedLanguages[b.language] ?? 0) + 1;
    }
  }

  // Mismatched = confidently detected AND a language other than expected.
  const offenders = blocks.filter(
    (b) => b.language && b.language !== expectedLanguage && b.confidence >= minBlockConfidence,
  );

  const mixedBlockRatio = totalBlocks > 0 ? offenders.length / totalBlocks : 0;

  if (mixedBlockRatio <= mixedThreshold) {
    return { expectedLanguage, detectedLanguages, mixedBlockRatio, findings: [] };
  }

  // Dominant intruding language = most frequent among the offenders.
  const offenderCounts: Record<string, number> = {};
  for (const b of offenders) offenderCounts[b.language] = (offenderCounts[b.language] ?? 0) + 1;
  const dominantDetected = Object.entries(offenderCounts).sort((a, b) => b[1] - a[1])[0][0];

  // Finding confidence = mean confidence across blocks that got a language.
  const detected = blocks.filter((b) => b.language && b.confidence > 0);
  const meanConfidence = detected.length
    ? detected.reduce((sum, b) => sum + b.confidence, 0) / detected.length
    : 0;

  const fingerprint = sha1(`${RULE_ID}:${url}:${expectedLanguage}`);

  const examples = offenders
    .slice(0, 2)
    .map((b) => (b.text.length > EXAMPLE_TRUNCATE ? `${b.text.slice(0, EXAMPLE_TRUNCATE)}…` : b.text));

  const relatedUrl = buildCorrectLocaleUrl(
    url,
    config.localePathPrefixes[expectedLanguage],
    config.localePathPrefixes[dominantDetected],
  );

  const ratioPct = (mixedBlockRatio * 100).toFixed(0);
  const description =
    `This page is served at a URL that implies "${expectedLanguage}" content, but ` +
    `${offenders.length} of ${totalBlocks} text blocks (${ratioPct}%) were detected as a ` +
    `different language — dominantly "${dominantDetected}". A shopper expecting ` +
    `${expectedLanguage} sees mixed-locale copy. Offending examples: ` +
    examples.map((e) => `“${e}”`).join(' · ') +
    (relatedUrl ? ` Correctly-localised equivalent for reference: ${relatedUrl}` : '');

  const finding: Finding = {
    id: `f-${runId}-${fingerprint.slice(0, 8)}`,
    fingerprint,
    runId,
    discoveredAt: new Date().toISOString(),
    ruleId: RULE_ID,
    category: 'i18n',
    source: 'cross-page',
    severity: 'high',
    url,
    ...(relatedUrl ? { relatedUrls: [relatedUrl] } : {}),
    title: `Mixed-locale content on ${url}`,
    description,
    remediation:
      `Ensure every text block on this page is localised to "${expectedLanguage}". ` +
      `Check Shopify/Replo metafields and translation bindings for untranslated ` +
      `"${dominantDetected}" strings.`,
    confidence: meanConfidence,
    // No single element to gate; pre-confirm visible so the visual gate skips it.
    visualGate: {
      verdict: 'visible',
      reason: 'pre-confirmed by check (cross-page, page-level, no single element)',
      judgeModel: 'n/a',
    },
    meta: {
      expectedLanguage,
      dominantDetected,
      mixedBlockRatio: Number(mixedBlockRatio.toFixed(4)),
      blockCount: totalBlocks,
    },
  };

  return { expectedLanguage, detectedLanguages, mixedBlockRatio, findings: [finding] };
}

export default checkPageLanguage;
