// tests/unit/discovery-tools.test.ts
import { test, expect } from '@playwright/test';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTools } from '../../src/discovery/tools.js';
import type { Page } from '@playwright/test';

function makeMockPage(): Page {
  return {
    on: () => {},
    goto: async () => ({ status: () => 200 }),
    title: async () => 'Mock Page',
    url: () => 'https://www.ryzesuperfoods.com/',
    waitForTimeout: async () => {},
    screenshot: async ({ path }: { path: string }) => { writeFileSync(path, Buffer.from('PNG')); },
    evaluate: async () => {},
    content: async () => '<html></html>',
    locator: () => ({
      first: () => ({
        click: async () => {},
        innerHTML: async () => '<span>test</span>',
        waitFor: async () => {},
      }),
    }),
  } as unknown as Page;
}

const TMP_DIR = join(process.cwd(), 'data', 'tmp');
const TEST_DISCOVERIES = join(TMP_DIR, 'test-discoveries.jsonl');
const TEST_SCREENSHOTS = join(TMP_DIR, 'test-screenshots');

test.beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(TEST_SCREENSHOTS, { recursive: true });
  writeFileSync(TEST_DISCOVERIES, '');
});

test('navigate blocks disallowed host', async () => {
  const tools = createTools(makeMockPage(), {
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath: TEST_DISCOVERIES,
    personaName: 'test-persona',
  });
  const result = await tools.execute('navigate', { url: 'https://evil.com/steal' });
  expect(result.error).toContain('not an allowed host');
});

test('navigate blocks /admin path', async () => {
  const tools = createTools(makeMockPage(), {
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath: TEST_DISCOVERIES,
    personaName: 'test-persona',
  });
  const result = await tools.execute('navigate', { url: 'https://www.ryzesuperfoods.com/admin/products' });
  expect(result.error).toContain('restricted path');
});

test('navigate blocks /checkout path', async () => {
  const tools = createTools(makeMockPage(), {
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath: TEST_DISCOVERIES,
    personaName: 'test-persona',
  });
  const result = await tools.execute('navigate', { url: 'https://www.ryzesuperfoods.com/checkout' });
  expect(result.error).toContain('restricted path');
});

test('navigate allows ryzesuperfoods.com product page', async () => {
  const page = makeMockPage();
  const gotoSpy = { called: false };
  (page as unknown as { goto: (url: string) => Promise<{ status: () => number }> }).goto = async () => {
    gotoSpy.called = true;
    return { status: () => 200 };
  };
  const tools = createTools(page, {
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath: TEST_DISCOVERIES,
    personaName: 'test-persona',
  });
  const result = await tools.execute('navigate', { url: 'https://www.ryzesuperfoods.com/products/coffee' });
  expect(result.error).toBeUndefined();
  expect(gotoSpy.called).toBe(true);
});

test('navigate allows shop.ryzesuperfoods.com', async () => {
  const page = makeMockPage();
  const gotoSpy = { called: false };
  (page as unknown as { goto: (url: string) => Promise<{ status: () => number }> }).goto = async () => {
    gotoSpy.called = true;
    return { status: () => 200 };
  };
  const tools = createTools(page, {
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath: TEST_DISCOVERIES,
    personaName: 'test-persona',
  });
  const result = await tools.execute('navigate', { url: 'https://shop.ryzesuperfoods.com/products/coffee' });
  expect(result.error).toBeUndefined();
  expect(gotoSpy.called).toBe(true);
});

test('click blocks checkout selector', async () => {
  const tools = createTools(makeMockPage(), {
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath: TEST_DISCOVERIES,
    personaName: 'test-persona',
  });
  const result = await tools.execute('click', { selector: 'button[name="checkout"]' });
  expect(result.error).toContain('Blocked');
});

test('submit_finding rejects missing url', async () => {
  const tools = createTools(makeMockPage(), {
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath: TEST_DISCOVERIES,
    personaName: 'test-persona',
  });
  const result = await tools.execute('submit_finding', {
    screenshot: 'output/screenshots/test.png',
    quotedElement: '<button>ATC</button>',
    claim: 'ATC button missing',
    severity: 'high',
    bugClass: 'revenue',
    ruleId: 'discovery:no-atc',
  });
  expect(result.accepted).toBe(false);
  expect(result.rejectionReason).toBe('missing url');
});

test('submit_finding writes valid finding to disk immediately', async ({}, testInfo) => {
  // Use worker-unique path to avoid parallel-project write collisions
  const discoveriesPath = join(TMP_DIR, `discoveries-${testInfo.workerIndex}.jsonl`);
  writeFileSync(discoveriesPath, '');
  const tools = createTools(makeMockPage(), {
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath,
    personaName: 'revenue-hawk',
  });
  const result = await tools.execute('submit_finding', {
    url: 'https://www.ryzesuperfoods.com/products/coffee',
    screenshot: 'output/screenshots/test.png',
    quotedElement: '<span class="price">$0</span>',
    claim: 'Price shows $0 on product page',
    severity: 'critical',
    bugClass: 'revenue',
    ruleId: 'discovery:zero-price',
  });
  expect(result.accepted).toBe(true);
  const written = readFileSync(discoveriesPath, 'utf8').split('\n').filter(Boolean);
  expect(written).toHaveLength(1);
  const finding = JSON.parse(written[0]);
  expect(finding.persona).toBe('revenue-hawk');
  expect(finding.ruleId).toBe('discovery:zero-price');
});

test('unknown tool returns error', async () => {
  const tools = createTools(makeMockPage(), {
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath: TEST_DISCOVERIES,
    personaName: 'test-persona',
  });
  const result = await tools.execute('nonexistent_tool', {});
  expect(result.error).toContain('Unknown tool');
});
