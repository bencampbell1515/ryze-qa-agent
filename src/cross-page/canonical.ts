/**
 * Loader + validator for the canonical record (config/canonical-record.json).
 *
 * The brief's open-assumption #1 suggested src/config/canonical.ts, but this
 * worktree's boundaries forbid touching src/config/. The content-rule checks
 * receive `canonical` as a parameter, so this loader is only needed by callers
 * (and the dry-run); it lives in src/cross-page/ to stay inside the boundary.
 * If a shared loader is wanted later, this can be promoted to src/config/ in a
 * follow-up PR.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { CanonicalRecord } from '../types/finding.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(here, '../../config/canonical-record.json');

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`canonical-record.json invalid: ${msg}`);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Read and validate the canonical record. Throws on malformed input. */
export function loadCanonicalRecord(path: string = DEFAULT_PATH): CanonicalRecord {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

  assert(isStringArray(raw.businessAddresses), 'businessAddresses must be string[]');
  assert(typeof raw.supportEmail === 'string', 'supportEmail must be a string');
  assert(typeof raw.brandName === 'string', 'brandName must be a string');
  assert(isStringArray(raw.brandVariants), 'brandVariants must be string[]');
  assert(
    Array.isArray(raw.acceptableCopyrightYears) &&
      raw.acceptableCopyrightYears.every((x) => typeof x === 'number'),
    'acceptableCopyrightYears must be number[]'
  );
  assert(
    raw.localePathPrefixes !== null &&
      typeof raw.localePathPrefixes === 'object' &&
      Object.values(raw.localePathPrefixes as object).every((v) => typeof v === 'string'),
    'localePathPrefixes must be Record<string,string>'
  );
  assert(isStringArray(raw.brandTerms), 'brandTerms must be string[]');

  return {
    businessAddresses: raw.businessAddresses as string[],
    supportEmail: raw.supportEmail as string,
    brandName: raw.brandName as string,
    brandVariants: raw.brandVariants as string[],
    acceptableCopyrightYears: raw.acceptableCopyrightYears as number[],
    localePathPrefixes: raw.localePathPrefixes as Record<string, string>,
    brandTerms: raw.brandTerms as string[],
  };
}
