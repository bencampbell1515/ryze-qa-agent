/**
 * Cross-page entity consistency check (worktree G).
 *
 * Extracts named entities (US street addresses, emails, phone numbers) from a
 * page's text with deterministic regex — NO LLM in the MVP hot path — and
 * asserts them against the project's CanonicalRecord. The headline bug this
 * catches is two different physical addresses listed on the same page (e.g.
 * the Terms of Service page listing both the HQ and a fulfillment address).
 *
 * Design stance: be conservative. A missed entity is cheaper than a false
 * positive on a SKU or order number that happens to look address-shaped.
 * US-style addresses only; international formats are an explicit follow-up
 * (see the i18n-address-extraction TODO on the PR).
 *
 * @see docs/check-author-guide.md for the Finding contract and fingerprinting.
 */

import { createHash } from 'node:crypto';
import type { Finding, CanonicalRecord, VisualGateVerdict } from '../types/finding.js';

export interface EntityExtractionResult {
  addresses: string[];
  emails: string[];
  phoneNumbers: string[];
}

export interface EntityCheckResult {
  findings: Finding[];
  extracted: EntityExtractionResult;
}

// ---------------------------------------------------------------------------
// Extraction regexes
// ---------------------------------------------------------------------------

/**
 * Street-type suffixes, longest-first within each pair (Avenue before Ave,
 * Street before St) so the alternation prefers the fuller spelling when both
 * could match. Title-case only and the overall regex is case-sensitive —
 * requiring conventional address casing is a deliberate precision lever.
 */
const STREET_SUFFIX =
  '(?:Avenue|Ave|Street|St|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|' +
  'Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Terrace|Ter|Circle|Cir|Way)';

/** Optional secondary unit designator (Suite 4, Fl. 14, #200, Apt 3B, ...). */
const UNIT =
  '(?:,?\\s+(?:Apt|Apartment|Suite|Ste|Unit|Fl|Floor|Bldg|Building|Rm|Room|#)\\.?\\s*[A-Za-z0-9-]+)?';

/**
 * US street address:  <number> <street> <suffix>[. ][unit], <city>, <ST> <ZIP>
 * The ZIP and uppercase two-letter state are the anchors that keep this from
 * matching arbitrary "<number> <word>" copy.
 */
const ADDRESS_RE = new RegExp(
  '\\b\\d{1,6}\\s+[A-Za-z0-9][A-Za-z0-9.\'\\- ]*?\\s' + // street number + name
    STREET_SUFFIX +
    '\\b\\.?' + // street suffix (optional trailing dot)
    UNIT +
    ',\\s*[A-Za-z][A-Za-z.\\- ]+' + // city
    ',\\s*([A-Z]{2})\\s+(\\d{5}(?:-\\d{4})?)\\b', // state + ZIP
  'g',
);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * US phone numbers. Requires either parenthesized area code or explicit
 * separators between the three groups, so a bare 10-digit run (order ids,
 * tracking numbers) does not get mistaken for a phone number.
 */
const PHONE_RE =
  /(?:\+?1[-.\s])?(?:\((\d{3})\)|(\d{3}))[-.\s](\d{3})[-.\s](\d{4})\b/g;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Display/dedup form: collapse whitespace, trim, uppercase the state code. */
function normalizeAddress(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  // Uppercase the ", XX " state code that precedes the ZIP.
  return collapsed.replace(/,\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\b/, (_m, st, zip) => {
    return `, ${String(st).toUpperCase()} ${zip}`;
  });
}

/**
 * Aggressive match key: lowercase, strip all punctuation, collapse whitespace.
 * Used both to dedup extracted addresses and to compare against canonical
 * entries (which may carry a company prefix the regex never captures, e.g.
 * "RYZE, INC., 600 Congress Ave., ..."). Comparison is substring-based on this
 * key so the captured street-through-ZIP span matches the fuller canonical.
 */
function addressKey(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

// ---------------------------------------------------------------------------
// extractEntities
// ---------------------------------------------------------------------------

/**
 * Extract entities from page text. Deterministic; no LLM.
 */
export function extractEntities(pageText: string): EntityExtractionResult {
  const text = pageText ?? '';

  // Addresses — normalize, then dedupe by aggressive key while preserving the
  // first normalized representative for display.
  const addressByKey = new Map<string, string>();
  for (const m of text.matchAll(ADDRESS_RE)) {
    const normalized = normalizeAddress(m[0]);
    const key = addressKey(normalized);
    if (!addressByKey.has(key)) addressByKey.set(key, normalized);
  }
  const addresses = Array.from(addressByKey.values());

  // Emails — lowercase + dedupe.
  const emails = dedupe(
    Array.from(text.matchAll(EMAIL_RE), (m) => m[0].toLowerCase()),
  );

  // Phones — normalize to +1-XXX-XXX-XXXX + dedupe.
  const phoneNumbers = dedupe(
    Array.from(text.matchAll(PHONE_RE), (m) => {
      const area = m[1] ?? m[2];
      return `+1-${area}-${m[3]}-${m[4]}`;
    }),
  );

  return { addresses, emails, phoneNumbers };
}

// ---------------------------------------------------------------------------
// Finding construction
// ---------------------------------------------------------------------------

const PRE_CONFIRMED_VISIBLE: VisualGateVerdict = {
  verdict: 'visible',
  reason: 'pre-confirmed by check: cross-page text assertion, no element to gate',
  judgeModel: 'n/a',
};

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

interface FindingDraft {
  fingerprint: string;
  ruleId: string;
  severity: Finding['severity'];
  title: string;
  description: string;
  meta: Finding['meta'];
}

function buildFinding(url: string, runId: string, draft: FindingDraft): Finding {
  return {
    id: `f-${runId}-${draft.fingerprint.slice(0, 12)}`,
    fingerprint: draft.fingerprint,
    runId,
    discoveredAt: new Date().toISOString(),
    ruleId: draft.ruleId,
    category: 'cross-page',
    source: 'cross-page',
    severity: draft.severity,
    url,
    relatedUrls: [url],
    visualGate: PRE_CONFIRMED_VISIBLE,
    title: draft.title,
    description: draft.description,
    confidence: 0.9,
    meta: draft.meta,
  };
}

/** Local part of an email below which a non-canonical ryze address is allowed. */
const SUPPORT_EMAIL_ALLOWLIST = new Set(['legal', 'press', 'jobs', 'careers', 'team']);
const RYZE_EMAIL_DOMAIN = /(^|\.)ryzesuperfoods\.com$/i;

// ---------------------------------------------------------------------------
// checkEntityConsistency
// ---------------------------------------------------------------------------

/**
 * Assert extracted entities against the canonical record, emitting findings
 * for inconsistencies. Async to match the cross-page check signature, but the
 * MVP path is fully synchronous (no LLM, no network).
 */
export async function checkEntityConsistency(
  url: string,
  pageText: string,
  canonical: CanonicalRecord,
  runId: string,
): Promise<EntityCheckResult> {
  const extracted = extractEntities(pageText);
  const findings: Finding[] = [];

  const canonicalAddressKeys = canonical.businessAddresses.map(addressKey);
  const isCanonicalAddress = (addr: string): boolean => {
    const key = addressKey(addr);
    // Substring match handles canonical entries that carry a company prefix.
    return canonicalAddressKeys.some((ck) => ck === key || ck.includes(key));
  };

  // --- Address checks -------------------------------------------------------

  // (a) Any non-canonical address → one unknown-address finding per address.
  for (const addr of extracted.addresses) {
    if (isCanonicalAddress(addr)) continue;
    const fingerprint = sha1(`cross-page:unknown-address:${url}:${addr}`);
    findings.push(
      buildFinding(url, runId, {
        fingerprint,
        ruleId: 'cross-page:unknown-address',
        severity: 'high',
        title: `Non-canonical address found on ${url}`,
        description:
          `The address "${addr}" appears on this page but is not in the ` +
          `canonical business address list (${canonical.businessAddresses.join('; ')}). ` +
          `Either the page is wrong or the canonical record is stale — reconcile the two.`,
        meta: {
          unknownAddress: addr,
          extractedAddresses: extracted.addresses.join(' | '),
          canonicalAddresses: canonical.businessAddresses.join(' | '),
        },
      }),
    );
  }

  // (b) More than one DISTINCT address on a single page → multiple-addresses.
  //     This is the TOS bug — fires regardless of canonical membership.
  const distinctAddressKeys = dedupe(extracted.addresses.map(addressKey));
  if (distinctAddressKeys.length > 1) {
    const sorted = [...extracted.addresses].sort();
    const fingerprint = sha1(
      `cross-page:multiple-addresses:${url}:${JSON.stringify(
        sorted.map(addressKey).sort(),
      )}`,
    );
    findings.push(
      buildFinding(url, runId, {
        fingerprint,
        ruleId: 'cross-page:multiple-addresses',
        severity: 'high',
        title: `Multiple distinct addresses found on ${url}`,
        description:
          `This page lists ${distinctAddressKeys.length} different physical ` +
          `addresses: ${sorted.join(' AND ')}. A single page (especially a ` +
          `policy/Terms page) should reference one canonical business address. ` +
          `Conflicting addresses erode trust and create legal ambiguity.`,
        meta: {
          addressCount: distinctAddressKeys.length,
          addresses: sorted.join(' | '),
        },
      }),
    );
  }

  // --- Email checks ---------------------------------------------------------

  for (const email of extracted.emails) {
    if (!RYZE_EMAIL_DOMAIN.test(email.split('@')[1] ?? '')) continue; // not customer-facing
    if (email === canonical.supportEmail.toLowerCase()) continue; // the canonical one
    const localPart = email.split('@')[0] ?? '';
    if (SUPPORT_EMAIL_ALLOWLIST.has(localPart)) continue; // legal@, press@, ...

    const fingerprint = sha1(`cross-page:non-canonical-support-email:${url}:${email}`);
    findings.push(
      buildFinding(url, runId, {
        fingerprint,
        ruleId: 'cross-page:non-canonical-support-email',
        severity: 'medium',
        title: `Non-canonical support email found on ${url}`,
        description:
          `The address "${email}" looks like a customer-facing RYZE email but ` +
          `is not the canonical support email (${canonical.supportEmail}). ` +
          `Customers reaching this inbox may not get a support response. ` +
          `Use the canonical address or add this local part to the allowlist if intentional.`,
        meta: {
          foundEmail: email,
          canonicalSupportEmail: canonical.supportEmail,
        },
      }),
    );
  }

  return { findings, extracted };
}
