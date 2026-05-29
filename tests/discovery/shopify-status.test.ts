import { test, expect } from '@playwright/test';
import {
  filterByShopifyStatus,
  type ShopifyStatusConfig,
} from '../../src/discovery/shopify-status.js';

const RUN_ID = 'run-test-002';

const cfg = (over: Partial<ShopifyStatusConfig> = {}): ShopifyStatusConfig => ({
  shopDomain: 'ryzesuperfoods',
  adminToken: 'shpat_testtoken',
  apiVersion: '2025-10',
  ...over,
});

/** Parse the `handle:a OR handle:b` query string back into handle list. */
function handlesFromQuery(q: string): string[] {
  return q
    .split(/\s+OR\s+/)
    .map((t) => t.replace(/^handle:/, '').trim())
    .filter(Boolean);
}

interface FetchScript {
  /** status code per call index (default 200). */
  statuses?: number[];
  /** handle -> status the API "knows about". Missing handles are omitted from edges. */
  statusMap: Record<string, string>;
}

function makeFetch(script: FetchScript) {
  const bodies: any[] = [];
  let call = 0;
  const fn = async (_url: string, init: any) => {
    const idx = call++;
    const status = script.statuses?.[idx] ?? 200;
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (status !== 200) {
      return { ok: false, status, json: async () => ({}), text: async () => 'rate limited' };
    }
    const asked = handlesFromQuery(body.variables.query);
    const edges = asked
      .filter((h) => h in script.statusMap)
      .map((h) => ({ node: { handle: h, status: script.statusMap[h] } }));
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { products: { edges } } }),
      text: async () => '',
    };
  };
  return {
    fn: fn as unknown as typeof fetch,
    get callCount() {
      return call;
    },
    bodies,
  };
}

const url = (handle: string) => `https://www.ryzesuperfoods.com/products/${handle}`;

test.describe('shopify-status: filterByShopifyStatus', () => {
  test('positive: ACTIVE handle survives', async () => {
    const f = makeFetch({ statusMap: { 'mushroom-coffee': 'ACTIVE' } });
    const res = await filterByShopifyStatus([url('mushroom-coffee')], cfg(), RUN_ID, {
      fetchImpl: f.fn,
    });
    expect(res.active).toEqual([url('mushroom-coffee')]);
    expect(res.excluded).toHaveLength(0);
  });

  test('positive: DRAFT handle excluded with reason shopify-draft', async () => {
    const f = makeFetch({ statusMap: { 'copy-of-foo': 'DRAFT' } });
    const res = await filterByShopifyStatus([url('copy-of-foo')], cfg(), RUN_ID, {
      fetchImpl: f.fn,
    });
    expect(res.active).toHaveLength(0);
    expect(res.excluded).toHaveLength(1);
    expect(res.excluded[0].reason).toBe('shopify-draft');
    expect(res.excluded[0].url).toBe(url('copy-of-foo'));
    expect(res.excluded[0].detail?.status).toBe('DRAFT');
    expect(res.excluded[0].runId).toBe(RUN_ID);
  });

  test('positive: ARCHIVED → shopify-archived, UNLISTED → shopify-unlisted', async () => {
    const f = makeFetch({ statusMap: { arc: 'ARCHIVED', unl: 'UNLISTED' } });
    const res = await filterByShopifyStatus([url('arc'), url('unl')], cfg(), RUN_ID, {
      fetchImpl: f.fn,
    });
    expect(res.active).toHaveLength(0);
    const byReason = Object.fromEntries(res.excluded.map((e) => [e.reason, e.detail?.status]));
    expect(byReason['shopify-archived']).toBe('ARCHIVED');
    expect(byReason['shopify-unlisted']).toBe('UNLISTED');
  });

  test('positive: handle not in response excluded with reason shopify-not-found', async () => {
    const f = makeFetch({ statusMap: {} });
    const res = await filterByShopifyStatus([url('ghost-handle')], cfg(), RUN_ID, {
      fetchImpl: f.fn,
    });
    expect(res.active).toHaveLength(0);
    expect(res.excluded).toHaveLength(1);
    expect(res.excluded[0].reason).toBe('shopify-not-found');
    expect(res.excluded[0].detail?.status).toBe('not-found');
  });

  test('non-product URLs pass through to active unchanged, never queried', async () => {
    const f = makeFetch({ statusMap: {} });
    const collection = 'https://www.ryzesuperfoods.com/collections/all';
    const res = await filterByShopifyStatus([collection], cfg(), RUN_ID, { fetchImpl: f.fn });
    expect(res.active).toEqual([collection]);
    expect(res.excluded).toHaveLength(0);
    expect(f.callCount).toBe(0);
  });

  test('handle extraction strips query string and trailing slash', async () => {
    const f = makeFetch({ statusMap: { 'mushroom-coffee': 'ACTIVE' } });
    const dirty = 'https://www.ryzesuperfoods.com/products/mushroom-coffee/?variant=42';
    const res = await filterByShopifyStatus([dirty], cfg(), RUN_ID, { fetchImpl: f.fn });
    expect(res.active).toEqual([dirty]);
    expect(f.bodies[0].variables.query).toContain('handle:mushroom-coffee');
  });

  test('batch of 75 handles split into two GraphQL queries', async () => {
    const handles = Array.from({ length: 75 }, (_, i) => `p${i}`);
    const statusMap = Object.fromEntries(handles.map((h) => [h, 'ACTIVE']));
    const f = makeFetch({ statusMap });
    const res = await filterByShopifyStatus(handles.map(url), cfg(), RUN_ID, { fetchImpl: f.fn });
    expect(res.active).toHaveLength(75);
    expect(f.callCount).toBe(2);
  });

  test('duplicate handle is only queried once (per-run cache)', async () => {
    const f = makeFetch({ statusMap: { 'mushroom-coffee': 'ACTIVE' } });
    const dup = [url('mushroom-coffee'), url('mushroom-coffee') + '?ref=x'];
    const res = await filterByShopifyStatus(dup, cfg(), RUN_ID, { fetchImpl: f.fn });
    // Both URLs survive (same ACTIVE handle) but only one query issued.
    expect(res.active).toHaveLength(2);
    expect(f.callCount).toBe(1);
  });

  test('on first 429, retries once after sleep then succeeds', async () => {
    const f = makeFetch({ statuses: [429, 200], statusMap: { ok: 'ACTIVE' } });
    const sleeps: number[] = [];
    const res = await filterByShopifyStatus([url('ok')], cfg(), RUN_ID, {
      fetchImpl: f.fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(res.active).toEqual([url('ok')]);
    expect(f.callCount).toBe(2);
    expect(sleeps).toHaveLength(1);
  });

  test('on second 429, throws', async () => {
    const f = makeFetch({ statuses: [429, 429], statusMap: { ok: 'ACTIVE' } });
    const sleeps: number[] = [];
    await expect(
      filterByShopifyStatus([url('ok')], cfg(), RUN_ID, {
        fetchImpl: f.fn,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).rejects.toThrow();
    expect(f.callCount).toBe(2);
    expect(sleeps).toHaveLength(1);
  });

  test('THROTTLED error in 200 body triggers the same retry path', async () => {
    let call = 0;
    const fetchImpl = (async (_u: string, init: any) => {
      const idx = call++;
      if (idx === 0) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ errors: [{ extensions: { code: 'THROTTLED' } }] }),
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { products: { edges: [{ node: { handle: 'ok', status: 'ACTIVE' } }] } } }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;
    const res = await filterByShopifyStatus([url('ok')], cfg(), RUN_ID, {
      fetchImpl,
      sleep: async () => {},
    });
    expect(res.active).toEqual([url('ok')]);
    expect(call).toBe(2);
  });

  test('missing token throws at construction', async () => {
    await expect(
      filterByShopifyStatus([url('x')], cfg({ adminToken: '' }), RUN_ID, {
        fetchImpl: makeFetch({ statusMap: {} }).fn,
      }),
    ).rejects.toThrow(/token/i);
  });

  test('missing shopDomain throws at construction', async () => {
    await expect(
      filterByShopifyStatus([url('x')], cfg({ shopDomain: '' }), RUN_ID, {
        fetchImpl: makeFetch({ statusMap: {} }).fn,
      }),
    ).rejects.toThrow(/domain/i);
  });

  test('empty input returns empty result with no queries', async () => {
    const f = makeFetch({ statusMap: {} });
    const res = await filterByShopifyStatus([], cfg(), RUN_ID, { fetchImpl: f.fn });
    expect(res.active).toEqual([]);
    expect(res.excluded).toEqual([]);
    expect(f.callCount).toBe(0);
  });
});
