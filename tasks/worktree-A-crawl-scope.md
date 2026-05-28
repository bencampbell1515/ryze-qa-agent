# Worktree A: Crawl Scope Filtering + Shopify Status

## Mission

Add a scope-filter layer to URL discovery that removes URLs that should never
be audited, and a Shopify Admin API integration that intersects discovered
product URLs with `status == ACTIVE`. Emit `HygieneFinding` objects for
excluded URLs so the team can see what's being filtered.

## Why

Today the agent audits dozens of URLs that no shopper ever sees:
`/products/copy-of-*` (duplicated drafts), `/luka/cro-tests/*` (internal CRO
test variants), `/bridge/*`, debug routes. Each one wastes ~30-60s of audit
time and produces noisy findings on pages that aren't real. Shopify is the
authoritative answer to "is this a real, public product."

Symptoms in the most recent audit:
- 9+ findings on `/products/copy-of-handmade-acacia-spoon`,
  `/products/copy-of-mushroom-magnet-acacia-spoon`, etc.
- Findings on `/luka/cro-tests/creative-single-bag-image-testing/v1-modern-experience`
  through v4, plus delivery-date tests.
- Findings on `/cart/mc01-dynamic` and `/cart/mc-ca01` (ad-link test endpoints).

This worktree kills the entire scope-creep false-positive class in one pass.

## Files to create

### `src/discovery/scope-filter.ts`

```typescript
import type { HygieneFinding } from '../types/finding';

export interface ScopeFilterConfig {
  denyPatterns: string[];
  allowOverrides: string[];
}

export interface ScopeFilterResult {
  audit: string[];
  hygiene: HygieneFinding[];
}

export function applyScopeFilter(
  urls: string[],
  config: ScopeFilterConfig,
  runId: string
): ScopeFilterResult;
```

Behavior:
- Patterns are matched as substring contains (no regex unless prefixed with
  `re:`). Substrings cover the audit findings; regex is an escape hatch.
- For every excluded URL, emit a HygieneFinding with
  `reason: 'deny-list-match'` and `detail: { pattern: <the pattern that matched> }`.
- `allowOverrides` is an exact-URL list. URLs in this list always survive
  even if they match a deny pattern. Use sparingly.
- Return surviving URLs as `audit` and the hygiene findings as `hygiene`.
- Deterministic, no I/O, no async.

### `src/discovery/shopify-status.ts`

```typescript
import type { HygieneFinding } from '../types/finding';

export interface ShopifyStatusConfig {
  shopDomain: string;        // e.g. "ryzesuperfoods"
  adminToken: string;
  apiVersion: string;        // default "2025-10"
  batchSize?: number;        // default 50
}

export interface ShopifyStatusResult {
  active: string[];
  excluded: HygieneFinding[];
}

export async function filterByShopifyStatus(
  productUrls: string[],
  config: ShopifyStatusConfig,
  runId: string
): Promise<ShopifyStatusResult>;
```

Behavior:
- Extract product handles from URLs matching `/products/<handle>` (strip
  query strings, trailing slashes). URLs that don't match are passed through
  to `active` unchanged.
- Batch-query Shopify Admin GraphQL API in chunks of `batchSize` handles.
- Treat status `ACTIVE` as audit-eligible. Everything else is excluded:
  - `DRAFT` → `reason: 'shopify-draft'`
  - `ARCHIVED` → `reason: 'shopify-archived'`
  - `UNLISTED` (API 2025-10+) → `reason: 'shopify-unlisted'`
  - Handle not in response → `reason: 'shopify-not-found'`
- Each excluded URL gets a HygieneFinding with `detail: { status: <the value> }`.
- In-memory cache per run: don't query the same handle twice.

GraphQL endpoint:
```
https://${config.shopDomain}.myshopify.com/admin/api/${config.apiVersion}/graphql.json
```

Auth header: `X-Shopify-Access-Token: ${config.adminToken}`.

Query:
```graphql
query getProductStatuses($query: String!) {
  products(first: 50, query: $query) {
    edges {
      node {
        handle
        status
      }
    }
  }
}
```

Where `$query` is `"handle:h1 OR handle:h2 OR ..."`.

Rate limiting:
- Shopify Admin API uses leaky-bucket cost. Batch of 50 should land well
  under the limit.
- On HTTP 429 or `THROTTLED` error in response body, sleep 2 seconds, retry
  once. On second throttle, fail the whole call (don't burn the run trying
  to muscle through).

Errors:
- Missing env vars: throw at construction, don't silently no-op.
- Network failure: throw, let orchestrate decide to skip or fail the run.
- Don't fall back to "audit everything" on failure. That's how scope creep
  came back in the past.

### `src/discovery/index.ts` (modify - SMALL change only)

After the existing crawl produces its URL list, run them through:

1. `applyScopeFilter(urls, config, runId)` → `audit` survives, hygiene
   findings collected.
2. Of the survivors, separate product URLs (matching `/products/`) from
   non-product URLs.
3. `filterByShopifyStatus(productUrls, ...)` → `active` survives.
4. Return `[...active, ...nonProductUrls]` as the final audit list and
   append all hygiene findings to the run's hygiene stream.

DO NOT refactor the existing crawl. DO NOT touch any other file in
`src/discovery/`. If you find a function that needs to change, leave a
`// TODO(worktree-A):` comment and surface it on the PR.

## Tests

`tests/discovery/scope-filter.test.ts`:
- positive: `/products/copy-of-foo` matches deny-list → excluded
- positive: `/luka/cro-tests/v1` excluded
- negative: `/products/mushroom-coffee` survives
- edge: URL in `allowOverrides` survives despite matching a deny pattern
- empty input returns empty output (no errors)

`tests/discovery/shopify-status.test.ts`:
- positive: handle returned as ACTIVE survives
- positive: handle returned as DRAFT excluded with `reason: 'shopify-draft'`
- positive: handle not in response excluded with `reason: 'shopify-not-found'`
- batch of 75 handles split into two GraphQL queries
- on first 429, retries once after sleep
- on second 429, throws
- missing token throws at construction

Mock the Shopify API using `msw` or `nock`. Never hit live API in tests.

## Success criteria

- `npm run test:unit` passes.
- A dry-run on a known URL list that includes one `copy-of-*` and one
  known DRAFT handle excludes both and emits two hygiene findings.
- No changes outside `src/discovery/`, `tests/discovery/`,
  `config/scope-filter.json` (only if it doesn't exist after preflight),
  `.env.example` (only if missing the Shopify vars after preflight).

## Reference

- `src/types/finding.ts` — Finding and HygieneFinding shapes
- `docs/check-author-guide.md` — conventions
- `CLAUDE.md` — repo-wide rules
- `README.md` — what the crawl does today
- `src/discovery/*` — read existing crawl to learn structure
- Shopify ProductStatus enum docs:
  https://shopify.dev/docs/api/admin-graphql/latest/enums/ProductStatus

## Boundaries — do not

- Modify any check module under `src/checks/`
- Modify orchestrate
- Refactor the crawl
- Invent new HygieneFinding `reason` values beyond the ones in
  `src/types/finding.ts`
- Add new env vars beyond `SHOPIFY_SHOP_DOMAIN` and `SHOPIFY_ADMIN_TOKEN`
- Commit `.env`

## PR convention

Title: `worktree-A: crawl scope filtering + Shopify status`

Description must list:
- Files added
- Files modified
- Env vars added
- Tests added
- Manual dry-run result (paste the URL list and the hygiene findings produced)

Tag for review. Do not self-merge.

## Open assumptions to verify

1. Existing crawl exports a function or array of URLs at a known location in
   `src/discovery/`. Confirm and import path.
2. The repo's test runner is Vitest. If it's Jest, adapt accordingly. Check
   `package.json` `scripts.test:unit`.
3. The hygiene stream collection point exists (likely in orchestrate or as
   a `data/hygiene.jsonl` write). If it doesn't yet, write to
   `data/hygiene.jsonl` and document on the PR.
