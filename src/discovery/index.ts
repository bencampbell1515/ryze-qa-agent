/**
 * Discovery scope pipeline (worktree A).
 *
 * Composes the two scope layers that sit between URL discovery and the audit:
 *
 *   1. applyScopeFilter      — drop deny-listed URLs (drafts, CRO tests, debug)
 *   2. filterByShopifyStatus — keep only ACTIVE Shopify products
 *
 * and merges the non-product survivors back in. Every dropped URL becomes a
 * HygieneFinding written to the run's hygiene stream (data/hygiene.jsonl until
 * a first-class stream exists — see PR notes / brief assumption #3).
 *
 * IMPORTANT — wiring status: this module is NOT yet called by the live crawl.
 * scripts/crawl.ts and src/crawl/* are outside worktree A's allowed paths, so
 * hooking `scopeAndFilterUrls` into the crawl's output is a deliberate
 * follow-up (see PR). Today this is exercised by tests and the dry-run script.
 *
 * TODO(worktree-A): call scopeAndFilterUrls() from scripts/crawl.ts after
 * discoverUrls() resolves, before writing output/url-list.json.
 */

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HygieneFinding } from '../types/finding.js';
import {
  applyScopeFilter,
  type ScopeFilterConfig,
} from './scope-filter.js';
import {
  filterByShopifyStatus,
  extractHandle,
  type ShopifyStatusConfig,
  type ShopifyStatusDeps,
} from './shopify-status.js';

export {
  applyScopeFilter,
  type ScopeFilterConfig,
  type ScopeFilterResult,
} from './scope-filter.js';
export {
  filterByShopifyStatus,
  extractHandle,
  type ShopifyStatusConfig,
  type ShopifyStatusResult,
  type ShopifyStatusDeps,
} from './shopify-status.js';

const DEFAULT_SCOPE_CONFIG_PATH = join(process.cwd(), 'config', 'scope-filter.json');
const DEFAULT_HYGIENE_PATH = join(process.cwd(), 'data', 'hygiene.jsonl');
const DEFAULT_API_VERSION = '2025-10';

export interface ScopeAndFilterOptions {
  /** Defaults to config/scope-filter.json. */
  scopeConfig?: ScopeFilterConfig;
  /** Defaults to one built from SHOPIFY_SHOP_DOMAIN / SHOPIFY_ADMIN_TOKEN. */
  shopifyConfig?: ShopifyStatusConfig;
  /** Injected fetch/sleep for the Shopify call (tests, dry-runs). */
  shopifyDeps?: ShopifyStatusDeps;
}

export interface ScopeAndFilterResult {
  /** Final audit list: ACTIVE products + non-product survivors. */
  audit: string[];
  /** All hygiene findings from both layers, in pipeline order. */
  hygiene: HygieneFinding[];
}

/** Load the deny-list config from disk (config/scope-filter.json). */
export function loadScopeFilterConfig(path: string = DEFAULT_SCOPE_CONFIG_PATH): ScopeFilterConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return {
    denyPatterns: Array.isArray(raw.denyPatterns) ? raw.denyPatterns : [],
    allowOverrides: Array.isArray(raw.allowOverrides) ? raw.allowOverrides : [],
  };
}

/** Build a ShopifyStatusConfig from the environment. Throws if the required
 *  creds are absent — we never silently skip the Shopify pass (that is how
 *  scope creep returned in the past). */
export function shopifyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ShopifyStatusConfig {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN?.trim() ?? '';
  const adminToken = env.SHOPIFY_ADMIN_TOKEN?.trim() ?? '';
  if (!shopDomain) {
    throw new Error('shopifyConfigFromEnv: SHOPIFY_SHOP_DOMAIN is not set.');
  }
  if (!adminToken) {
    throw new Error('shopifyConfigFromEnv: SHOPIFY_ADMIN_TOKEN is not set.');
  }
  return { shopDomain, adminToken, apiVersion: DEFAULT_API_VERSION };
}

/**
 * Run the full discovery scope pipeline over a flat URL list.
 *
 * 1. applyScopeFilter → deny-list survivors + hygiene.
 * 2. Split survivors into product (`/products/<handle>`) and non-product URLs.
 * 3. filterByShopifyStatus over the product URLs → ACTIVE survive + hygiene.
 * 4. audit = [...active, ...nonProductUrls]; hygiene = scope ++ shopify.
 *
 * Does NOT write to disk — call appendHygieneFindings() with the result if you
 * want the findings persisted. Deterministic given the same inputs and a
 * deterministic injected Shopify response.
 */
export async function scopeAndFilterUrls(
  urls: string[],
  runId: string,
  opts: ScopeAndFilterOptions = {},
): Promise<ScopeAndFilterResult> {
  const scopeConfig = opts.scopeConfig ?? loadScopeFilterConfig();
  const shopifyConfig = opts.shopifyConfig ?? shopifyConfigFromEnv();

  const scoped = applyScopeFilter(urls, scopeConfig, runId);

  const productUrls: string[] = [];
  const nonProductUrls: string[] = [];
  for (const url of scoped.audit) {
    if (extractHandle(url) !== null) productUrls.push(url);
    else nonProductUrls.push(url);
  }

  const shopify = await filterByShopifyStatus(productUrls, shopifyConfig, runId, opts.shopifyDeps);

  return {
    audit: [...shopify.active, ...nonProductUrls],
    hygiene: [...scoped.hygiene, ...shopify.excluded],
  };
}

/** Append hygiene findings to the run's hygiene stream (JSONL). Creates the
 *  parent directory if needed. No-op for an empty list. */
export function appendHygieneFindings(
  findings: HygieneFinding[],
  path: string = DEFAULT_HYGIENE_PATH,
): void {
  if (findings.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  const lines = findings.map((f) => JSON.stringify(f)).join('\n') + '\n';
  appendFileSync(path, lines, 'utf8');
}
