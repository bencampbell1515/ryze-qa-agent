import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractEntities,
  checkEntityConsistency,
} from '../../src/cross-page/entities.js';
import type { CanonicalRecord } from '../../src/types/finding.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'entities');

/** Canonical record mirroring config/canonical-record.json for assertions. */
const CANONICAL: CanonicalRecord = {
  businessAddresses: ['RYZE, INC., 600 Congress Ave., Fl. 14, Austin, TX 78701'],
  supportEmail: 'hello@ryzesuperfoods.com',
  brandName: 'RYZE',
  brandVariants: ['RYZE', 'Ryze'],
  acceptableCopyrightYears: [2025, 2026],
  localePathPrefixes: { es: '/es/', fr: '/fr/' },
  brandTerms: ['mushroom coffee', 'starter kit'],
};

const URL = 'https://www.ryzesuperfoods.com/policies/terms-of-service';

// ---------------------------------------------------------------------------
// extractEntities
// ---------------------------------------------------------------------------

test.describe('extractEntities', () => {
  test('positive: extracts a single US address', () => {
    const { addresses } = extractEntities('123 Main St, Boston, MA 02101');
    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toContain('Boston');
    expect(addresses[0]).toContain('MA');
  });

  test('negative: no addresses in plain text', () => {
    const { addresses } = extractEntities('We sell mushroom coffee and matcha.');
    expect(addresses).toEqual([]);
  });

  test('positive: dedupes the same address across whitespace variations', () => {
    const text =
      'Office: 123 Main St, Boston, MA 02101.\n' +
      'Mail to:   123   Main   St,   Boston,   MA   02101 please.';
    const { addresses } = extractEntities(text);
    expect(addresses).toHaveLength(1);
  });

  test('positive: extracts and lowercases an email', () => {
    const { emails } = extractEntities('Email HELLO@RyzeSuperfoods.com today.');
    expect(emails).toEqual(['hello@ryzesuperfoods.com']);
  });

  test('positive: normalizes a phone number to +1-XXX-XXX-XXXX', () => {
    const { phoneNumbers } = extractEntities('Call us at (555) 123-4567 anytime.');
    expect(phoneNumbers).toEqual(['+1-555-123-4567']);
  });

  test('edge: address-like product copy is NOT extracted (no street suffix)', () => {
    const { addresses } = extractEntities('Buy 123 units of mushroom coffee today.');
    expect(addresses).toEqual([]);
  });

  test('extracts a unit/floor address (the canonical RYZE form)', () => {
    const { addresses } = extractEntities(
      'Visit us at 600 Congress Ave., Fl. 14, Austin, TX 78701.',
    );
    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toContain('Austin');
  });
});

// ---------------------------------------------------------------------------
// checkEntityConsistency
// ---------------------------------------------------------------------------

test.describe('checkEntityConsistency', () => {
  test('positive: one canonical address → 0 findings', async () => {
    const text = 'Our office is at 600 Congress Ave., Fl. 14, Austin, TX 78701.';
    const { findings } = await checkEntityConsistency(URL, text, CANONICAL, 'run-1');
    expect(findings).toEqual([]);
  });

  test('positive: one non-canonical address → 1 unknown-address finding', async () => {
    const text = 'Ship returns to 1200 Warehouse Blvd, Reno, NV 89502.';
    const { findings } = await checkEntityConsistency(URL, text, CANONICAL, 'run-1');
    const unknown = findings.filter((f) => f.ruleId === 'cross-page:unknown-address');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].severity).toBe('high');
    expect(unknown[0].category).toBe('cross-page');
    expect(unknown[0].source).toBe('cross-page');
    // single address → no multiple-addresses finding
    expect(findings.filter((f) => f.ruleId === 'cross-page:multiple-addresses')).toHaveLength(0);
  });

  test('positive: TOS-style page with TWO different addresses → 1 multiple-addresses finding', async () => {
    const text = readFileSync(join(FIXTURES, 'tos-two-addresses.txt'), 'utf8');
    const { findings } = await checkEntityConsistency(URL, text, CANONICAL, 'run-1');
    const multi = findings.filter((f) => f.ruleId === 'cross-page:multiple-addresses');
    expect(multi).toHaveLength(1);
    expect(multi[0].severity).toBe('high');
    expect(multi[0].relatedUrls ?? [URL]).toContain(URL);
  });

  test('positive: non-canonical support email → 1 non-canonical-support-email finding', async () => {
    const text = 'For help email support@ryzesuperfoods.com and we will reply.';
    const { findings } = await checkEntityConsistency(URL, text, CANONICAL, 'run-1');
    const emailFindings = findings.filter(
      (f) => f.ruleId === 'cross-page:non-canonical-support-email',
    );
    expect(emailFindings).toHaveLength(1);
    expect(emailFindings[0].severity).toBe('medium');
  });

  test('negative: allowlisted email (legal@) → 0 email findings', async () => {
    const text = 'Send legal notices to legal@ryzesuperfoods.com only.';
    const { findings } = await checkEntityConsistency(URL, text, CANONICAL, 'run-1');
    expect(
      findings.filter((f) => f.ruleId === 'cross-page:non-canonical-support-email'),
    ).toHaveLength(0);
  });

  test('negative: canonical support email present → 0 email findings', async () => {
    const text = 'Questions? Email hello@ryzesuperfoods.com for support.';
    const { findings } = await checkEntityConsistency(URL, text, CANONICAL, 'run-1');
    expect(
      findings.filter((f) => f.ruleId === 'cross-page:non-canonical-support-email'),
    ).toHaveLength(0);
  });

  test('edge: empty page → 0 findings', async () => {
    const { findings, extracted } = await checkEntityConsistency(URL, '', CANONICAL, 'run-1');
    expect(findings).toEqual([]);
    expect(extracted.addresses).toEqual([]);
    expect(extracted.emails).toEqual([]);
  });

  test('all findings carry the required contract fields', async () => {
    const text = readFileSync(join(FIXTURES, 'tos-two-addresses.txt'), 'utf8');
    const { findings } = await checkEntityConsistency(URL, text, CANONICAL, 'run-xyz');
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.id).toMatch(/^f-run-xyz-/);
      expect(f.fingerprint).toMatch(/^[0-9a-f]{40}$/);
      expect(f.runId).toBe('run-xyz');
      expect(f.discoveredAt).toBeTruthy();
      expect(f.category).toBe('cross-page');
      expect(f.source).toBe('cross-page');
      expect(f.confidence).toBe(0.9);
      expect(f.visualGate?.verdict).toBe('visible');
      expect(f.title).toBeTruthy();
      expect(f.description).toBeTruthy();
    }
  });

  test('fingerprints are stable across runs for the same issue', async () => {
    const text = 'Ship returns to 1200 Warehouse Blvd, Reno, NV 89502.';
    const a = await checkEntityConsistency(URL, text, CANONICAL, 'run-a');
    const b = await checkEntityConsistency(URL, text, CANONICAL, 'run-b');
    expect(a.findings[0].fingerprint).toBe(b.findings[0].fingerprint);
  });
});
