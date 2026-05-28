# Worktree G: Entity Consistency (Addresses, Emails, Canonical Assertions)

## Mission

Extract named entities (addresses, emails) from each page and assert they
match the canonical record. The headline use case: two different physical
addresses listed in the Terms of Service page on the same site.

## Why

Audit miss: two different addresses listed in the TOS. The current pipeline
has no notion of "extract entities and assert consistency," so this kind
of bug is structurally invisible. Same is true for support email
inconsistency, conflicting copyright entities, etc.

## Files to create

### `src/cross-page/entities.ts`

```typescript
import type { Finding, CanonicalRecord } from '../types/finding';

export interface EntityExtractionResult {
  addresses: string[];
  emails: string[];
  phoneNumbers: string[];
}

export interface EntityCheckResult {
  findings: Finding[];
  extracted: EntityExtractionResult;
}

/**
 * Extract entities from page text (no LLM — uses regex + simple
 * normalization).
 */
export function extractEntities(pageText: string): EntityExtractionResult;

/**
 * Assert extracted entities against the canonical record. Emits findings
 * for inconsistencies.
 */
export async function checkEntityConsistency(
  url: string,
  pageText: string,
  canonical: CanonicalRecord,
  runId: string
): Promise<EntityCheckResult>;
```

### `extractEntities` behavior

Deterministic, no LLM.

**Addresses**:
- US-style address regex: street number + name + city + state +
  ZIP. Multiple variants:
  - `\d+\s+[\w\s]+(Ave|Avenue|St|Street|Rd|Road|Blvd|Boulevard|Way|Drive|Dr|Lane|Ln)[.,]?\s+[\w\s]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?`
- Normalize: trim, collapse whitespace, uppercase state code.
- Deduplicate after normalization.

**Emails**:
- Standard email regex.
- Lowercase.
- Deduplicate.

**Phone numbers**:
- US-style: `(\d{3})\s*[-.]?\s*(\d{3})\s*[-.]?\s*(\d{4})` and variants
  with parens and country code.
- Normalize to `+1-XXX-XXX-XXXX`.
- Deduplicate.

Be conservative. Better to miss an entity than to extract noise (e.g.,
"123 Main" as an address when it's a product SKU). When in doubt, don't
extract. Worktree G will iterate on precision.

### `checkEntityConsistency` behavior

For each page:

1. Run `extractEntities` on the page text.
2. Address check:
   - If extracted addresses include any address not in
     `canonical.businessAddresses`, emit:
     - `ruleId: 'cross-page:unknown-address'`
     - `severity: 'high'`
     - `title: "Non-canonical address found on <url>"`
     - Describes the unknown address(es) and the canonical list.
   - If extracted addresses include MORE THAN ONE distinct address on a
     single page (regardless of whether they match canonical), emit:
     - `ruleId: 'cross-page:multiple-addresses'`
     - `severity: 'high'`
     - This is the TOS bug.
   - Fingerprint addresses: `sha1('cross-page:unknown-address:' + url + ':' + normalizedAddress)`.
3. Email check:
   - If extracted emails include a customer-facing email
     (contains `@ryzesuperfoods.com` or similar) that's not
     `canonical.supportEmail`, emit:
     - `ruleId: 'cross-page:non-canonical-support-email'`
     - `severity: 'medium'`
   - Allow non-customer-facing emails (legal@, press@) to coexist
     without flagging; the rule is about the *support* email
     specifically. Use a simple allowlist: `legal`, `press`, `jobs`,
     `careers`, `team`. Everything else that's a `@ryzesuperfoods.com`
     address and isn't the canonical support email fires.

All findings:
- `category: 'cross-page'`
- `source: 'cross-page'`
- `confidence: 0.9` (regex extraction is high-precision when conservative)
- `visualGate: pre-confirmed visible`
- `meta`: includes the extracted values for debugging

### Optional escalation: LLM-assisted extraction

For pages where regex extraction misses (formatted addresses split across
lines, addresses inside complex HTML), an LLM can extract more reliably.
Skip for MVP unless time allows. If you add it:
- Use Claude with a Zod-validated structured output schema.
- Gate behind a config flag (`USE_LLM_ENTITY_EXTRACTION=true`).
- Cache per-page by URL + content hash (don't re-extract unchanged pages).

If you skip it, document on the PR as a follow-up.

## Tests

`tests/cross-page/entities.test.ts`:

extractEntities:
- positive: text "123 Main St, Boston, MA 02101" → 1 address extracted
- negative: text with no addresses → empty array
- positive: same address with whitespace variations → deduped to 1
- positive: email `hello@ryzesuperfoods.com` → 1 email extracted (lowercased)
- positive: phone `(555) 123-4567` → normalized to `+1-555-123-4567`
- edge: address-like text inside a product description "Buy 123 units"
  → NOT extracted (no street suffix)

checkEntityConsistency:
- positive: page with one canonical address → 0 findings
- positive: page with one NON-canonical address → 1
  `unknown-address` finding
- positive: TOS-style page with TWO different addresses → 1
  `multiple-addresses` finding
- positive: page with `support@ryzesuperfoods.com` when canonical is
  `hello@ryzesuperfoods.com` → 1 `non-canonical-support-email` finding
- negative: page with `legal@ryzesuperfoods.com` (allowed) → 0 findings
- edge: empty page → 0 findings

## Success criteria

- `npm run test:unit` passes.
- Dry-run on the TOS page produces a `cross-page:multiple-addresses`
  finding (this is the bug from the report).
- Dry-run on a known-clean page produces no false positives.
- No changes outside `src/cross-page/`, `tests/cross-page/`,
  `tests/fixtures/entities/`.

## Reference

- `src/types/finding.ts`
- `docs/check-author-guide.md`
- `config/canonical-record.json`
- The bug report PDF mentioned in `tasks/00-preflight.md`'s context for
  the specific TOS issue

## Boundaries — do not

- Modify check modules
- Modify orchestrate
- Call LLMs in the MVP path (LLM extraction is a documented stretch goal,
  gated behind a config flag)
- Extract entities the canonical record doesn't reference. We don't need
  to extract every named entity on the site, just the ones we assert on.
- Add Python or spaCy. Stay in pure-JS regex for MVP. spaCy is documented
  in the strategy doc as a possible future direction; not for this worktree.

## PR convention

Title: `worktree-G: entity consistency for addresses, emails`

Description must list:
- Files added
- Tests added
- Dry-run results: paste the multi-address TOS finding
- Precision spot-check: any false positives observed in dry-run, and
  what to do about them
- Whether LLM extraction was added or deferred

## Open assumptions to verify

1. `canonical.businessAddresses` is populated with the real RYZE business
   address(es) before this check runs in production. The preflight
   seeded it with a placeholder; surface this dependency.
2. International address formats are out of scope for MVP. US-style only.
   Document this and add an `i18n-address-extraction` TODO if RYZE
   expands.
