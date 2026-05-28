/**
 * Shopify product-status filter for URL discovery (worktree A).
 *
 * Shopify is the authoritative answer to "is this a real, public product."
 * This intersects discovered `/products/<handle>` URLs with the Admin GraphQL
 * API: only `ACTIVE` products are audit-eligible. DRAFT / ARCHIVED / UNLISTED
 * products and unknown handles are excluded and emit a HygieneFinding.
 *
 * Failure policy is deliberately strict: on auth/network/throttle failure we
 * THROW rather than fall back to "audit everything" — that fallback is exactly
 * how scope creep crept back in the past. orchestrate decides whether a thrown
 * error skips the Shopify pass or fails the run.
 *
 * See src/types/finding.ts (HygieneFinding) and the brief in
 * tasks/worktree-A-crawl-scope.md.
 */

import { createHash } from 'node:crypto';
import type { HygieneFinding } from '../types/finding.js';

export interface ShopifyStatusConfig {
  /** Shop subdomain, e.g. "ryzesuperfoods" (NOT the full myshopify host). */
  shopDomain: string;
  adminToken: string;
  /** Admin API version, e.g. "2025-10". */
  apiVersion: string;
  /** Handles per GraphQL query. Default 50 — well under the leaky-bucket cost. */
  batchSize?: number;
}

export interface ShopifyStatusResult {
  /** URLs eligible for audit (ACTIVE products + all non-product URLs). */
  active: string[];
  /** One HygieneFinding per excluded product URL. */
  excluded: HygieneFinding[];
}

/** Injectable dependencies — lets tests mock the network without nock/msw
 *  (neither is a repo dependency). Production uses global fetch + a real sleep. */
export interface ShopifyStatusDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const PRODUCT_RE = /\/products\/([^/?#]+)/;
const THROTTLE_SLEEP_MS = 2000;

type ExclusionReason =
  | 'shopify-draft'
  | 'shopify-archived'
  | 'shopify-unlisted'
  | 'shopify-not-found';

/** Map a Shopify ProductStatus to the HygieneFinding reason. ACTIVE returns
 *  null (not excluded). Unknown statuses are treated conservatively as
 *  not-found so we never silently audit something we can't classify. */
function reasonForStatus(status: string): ExclusionReason | null {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
      return null;
    case 'DRAFT':
      return 'shopify-draft';
    case 'ARCHIVED':
      return 'shopify-archived';
    case 'UNLISTED':
      return 'shopify-unlisted';
    default:
      return 'shopify-not-found';
  }
}

/** Extract the product handle from a `/products/<handle>` URL, stripping query
 *  string and trailing slash. Returns null for non-product URLs. */
export function extractHandle(url: string): string | null {
  const m = PRODUCT_RE.exec(url);
  if (!m) return null;
  return m[1].replace(/\/+$/, '') || null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function hygieneId(runId: string, reason: string, url: string): string {
  const shortHash = createHash('sha1').update(`${reason}:${url}`).digest('hex').slice(0, 8);
  return `h-${runId}-${shortHash}`;
}

const QUERY = `query getProductStatuses($query: String!) {
  products(first: 250, query: $query) {
    edges {
      node {
        handle
        status
      }
    }
  }
}`;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Issue one GraphQL request for a chunk of handles. Handles a single throttle
 *  (HTTP 429 or THROTTLED body) by sleeping once and retrying. A second
 *  throttle, a non-OK status, or a transport error throws. */
async function queryChunk(
  handles: string[],
  config: ShopifyStatusConfig,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<Record<string, string>> {
  const endpoint = `https://${config.shopDomain}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`;
  const queryStr = handles.map((h) => `handle:${h}`).join(' OR ');

  let throttled = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.adminToken,
      },
      body: JSON.stringify({ query: QUERY, variables: { query: queryStr } }),
    });

    if (res.status === 429) {
      if (throttled) {
        throw new Error('Shopify Admin API throttled twice (HTTP 429); aborting to avoid burning the run.');
      }
      throttled = true;
      await sleep(THROTTLE_SLEEP_MS);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Shopify Admin API returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json: any = await res.json();

    // THROTTLED can arrive as a 200 with an errors array.
    const isThrottled =
      Array.isArray(json?.errors) &&
      json.errors.some((e: any) => e?.extensions?.code === 'THROTTLED' || /throttle/i.test(e?.message ?? ''));
    if (isThrottled) {
      if (throttled) {
        throw new Error('Shopify Admin API throttled twice (THROTTLED); aborting to avoid burning the run.');
      }
      throttled = true;
      await sleep(THROTTLE_SLEEP_MS);
      continue;
    }

    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      throw new Error(`Shopify Admin API GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
    }

    const edges = json?.data?.products?.edges ?? [];
    const statuses: Record<string, string> = {};
    for (const edge of edges) {
      const node = edge?.node;
      if (node?.handle) statuses[node.handle] = node.status;
    }
    return statuses;
  }

  // Unreachable: the loop either returns or throws.
  throw new Error('Shopify Admin API: exhausted retries.');
}

export async function filterByShopifyStatus(
  productUrls: string[],
  config: ShopifyStatusConfig,
  runId: string,
  deps: ShopifyStatusDeps = {},
): Promise<ShopifyStatusResult> {
  // Validate config up front — missing creds throw rather than silently no-op.
  if (!config.shopDomain) {
    throw new Error('filterByShopifyStatus: missing shopDomain (set SHOPIFY_SHOP_DOMAIN).');
  }
  if (!config.adminToken) {
    throw new Error('filterByShopifyStatus: missing adminToken (set SHOPIFY_ADMIN_TOKEN).');
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const batchSize = config.batchSize ?? 50;

  const active: string[] = [];
  const excluded: HygieneFinding[] = [];
  const discoveredAt = new Date().toISOString();

  // Partition into product URLs (need a Shopify lookup) and pass-throughs.
  const productEntries: { url: string; handle: string }[] = [];
  for (const url of productUrls) {
    const handle = extractHandle(url);
    if (handle === null) {
      active.push(url); // non-product URL, unchanged
    } else {
      productEntries.push({ url, handle });
    }
  }

  // Per-run cache: query each distinct handle at most once.
  const distinctHandles = [...new Set(productEntries.map((e) => e.handle))];
  const statusByHandle = new Map<string, string>();

  for (const handleChunk of chunk(distinctHandles, batchSize)) {
    const statuses = await queryChunk(handleChunk, config, fetchImpl, sleep);
    for (const h of handleChunk) {
      // A handle absent from the response is recorded as not-found so the
      // per-URL pass below can attribute it without a second lookup.
      statusByHandle.set(h, h in statuses ? statuses[h] : '__NOT_FOUND__');
    }
  }

  for (const { url, handle } of productEntries) {
    const status = statusByHandle.get(handle) ?? '__NOT_FOUND__';
    if (status === '__NOT_FOUND__') {
      excluded.push({
        id: hygieneId(runId, 'shopify-not-found', url),
        runId,
        discoveredAt,
        reason: 'shopify-not-found',
        url,
        detail: { status: 'not-found', handle },
      });
      continue;
    }
    const reason = reasonForStatus(status);
    if (reason === null) {
      active.push(url);
    } else {
      excluded.push({
        id: hygieneId(runId, reason, url),
        runId,
        discoveredAt,
        reason,
        url,
        detail: { status, handle },
      });
    }
  }

  return { active, excluded };
}
