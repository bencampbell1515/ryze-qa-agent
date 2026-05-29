import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { checkLinks, type LycheeExecutor } from '../../src/cross-page/links.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'fixtures', 'links');
const CACHE = join(tmpdir(), 'ryze-lychee-test-cache');
const RUN_ID = 'testrun';

/**
 * Build a stubbed lychee executor. `--version` always succeeds; any other
 * invocation returns `json` as stdout. lychee exits non-zero when it finds
 * broken links, so `code` mirrors that.
 */
function mockExec(json: unknown, code = 2): LycheeExecutor {
  return async (_binPath, args) => {
    if (args.includes('--version')) {
      return { stdout: 'lychee 0.15.1', stderr: '', code: 0 };
    }
    return { stdout: JSON.stringify(json), stderr: '', code };
  };
}

const FAIL_404 = {
  total: 2,
  successful: 1,
  failures: 1,
  fail_map: {
    'one-broken.html': [
      {
        url: 'https://example.com/does-not-exist',
        status: { code: 404, text: 'Not Found' },
      },
    ],
  },
};

test('positive: a fixture with one 404 link produces one Finding', async () => {
  const result = await checkLinks(
    {
      inputs: [join(FIXTURES, 'one-broken.html')],
      internalDomains: ['example.com'],
      cacheDir: CACHE,
    },
    RUN_ID,
    mockExec(FAIL_404),
  );

  expect(result.findings).toHaveLength(1);
  const f = result.findings[0]!;
  expect(f.ruleId).toBe('cross-page:broken-link');
  expect(f.category).toBe('cross-page');
  expect(f.source).toBe('cross-page');
  expect(f.severity).toBe('high'); // internal domain
  expect(f.confidence).toBe(1.0);
  expect(f.relatedUrls).toEqual(['https://example.com/does-not-exist']);
  expect(f.meta?.httpStatus).toBe(404);
  expect(f.meta?.isFragment).toBe(false);
  expect(f.visualGate?.verdict).toBe('visible');

  // Fingerprint matches the brief's documented formula for broken links.
  const expectedFp = createHash('sha1')
    .update('cross-page:broken-link:one-broken.html:https://example.com/does-not-exist')
    .digest('hex');
  expect(f.fingerprint).toBe(expectedFp);

  expect(result.broken).toHaveLength(1);
  expect(result.broken[0]!.status).toBe(404);
});

test('positive: a working link produces zero Findings', async () => {
  const result = await checkLinks(
    {
      inputs: [join(FIXTURES, 'all-ok.html')],
      internalDomains: ['example.com'],
      cacheDir: CACHE,
    },
    RUN_ID,
    mockExec({ total: 2, successful: 2, failures: 0, fail_map: {} }, 0),
  );
  expect(result.findings).toHaveLength(0);
  expect(result.broken).toHaveLength(0);
});

test('positive: a broken anchor fragment produces a cross-page:broken-fragment Finding', async () => {
  const fragJson = {
    total: 2,
    successful: 1,
    failures: 1,
    fail_map: {
      'broken-fragment.html': [
        {
          url: 'https://example.com/page#section-that-is-missing',
          status: { code: 200, text: 'Fragment not found' },
        },
      ],
    },
  };
  const result = await checkLinks(
    {
      inputs: [join(FIXTURES, 'broken-fragment.html')],
      internalDomains: ['example.com'],
      includeFragments: true,
      cacheDir: CACHE,
    },
    RUN_ID,
    mockExec(fragJson),
  );

  expect(result.findings).toHaveLength(1);
  const f = result.findings[0]!;
  expect(f.ruleId).toBe('cross-page:broken-fragment');
  expect(f.severity).toBe('medium'); // fragments are always medium
  expect(f.meta?.isFragment).toBe(true);
  expect(result.broken[0]!.isFragment).toBe(true);
});

test('edge: lychee binary not on PATH throws a clear error at startup', async () => {
  const enoentExec: LycheeExecutor = async () => {
    const err = Object.assign(new Error('spawn lychee ENOENT'), { code: 'ENOENT' });
    throw err;
  };
  await expect(
    checkLinks(
      { inputs: [join(FIXTURES, 'all-ok.html')], internalDomains: ['example.com'], cacheDir: CACHE },
      RUN_ID,
      enoentExec,
    ),
  ).rejects.toThrow(/lychee binary not found/);
});

test('edge: lychee returns non-JSON throws with the raw output in the error', async () => {
  const badExec: LycheeExecutor = async (_b, args) => {
    if (args.includes('--version')) return { stdout: 'lychee 0.15.1', stderr: '', code: 0 };
    return { stdout: 'panicked at thread main: not json at all', stderr: 'boom', code: 1 };
  };
  await expect(
    checkLinks(
      { inputs: [join(FIXTURES, 'all-ok.html')], internalDomains: ['example.com'], cacheDir: CACHE },
      RUN_ID,
      badExec,
    ),
  ).rejects.toThrow(/not json at all/);
});

test('classification: same broken link flips severity by internalDomains config', async () => {
  const asInternal = await checkLinks(
    { inputs: [join(FIXTURES, 'one-broken.html')], internalDomains: ['example.com'], cacheDir: CACHE },
    RUN_ID,
    mockExec(FAIL_404),
  );
  expect(asInternal.findings[0]!.severity).toBe('high');

  const asExternal = await checkLinks(
    { inputs: [join(FIXTURES, 'one-broken.html')], internalDomains: ['some-other-domain.com'], cacheDir: CACHE },
    RUN_ID,
    mockExec(FAIL_404),
  );
  expect(asExternal.findings[0]!.severity).toBe('medium');
});
