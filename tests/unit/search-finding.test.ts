import { test, expect, chromium } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSearchCheck } from '../checks/search.js';
import { createFindingCollector } from '../../src/findings/index.js';
import type { BugInstance } from '../../src/types.js';

function fakeBugs() {
  const collected: Array<Omit<BugInstance, 'timestamp'>> = [];
  return { collected, add: (b: Omit<BugInstance, 'timestamp'>) => collected.push(b) };
}

/**
 * Serve any /search?q=... with a 200 page that has neither product links nor a
 * no-results message → classifySearchPage returns 'rendering-broken' →
 * runSearchCheck flags content:search-rendering-broken (high).
 */
const BROKEN_SEARCH_HTML =
  '<!DOCTYPE html><html><body><main>Some random content here</main></body></html>';

function startServer(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(BROKEN_SEARCH_HTML);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
    server.unref();
  });
}

function stopServer(server: Server): void {
  server.closeAllConnections?.();
  server.close();
}

test('search: dual-write emits a Finding alongside the rendering-broken bug', async () => {
  const { server, base } = await startServer();
  const dir = mkdtempSync(join(tmpdir(), 'ryze-search-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.goto(`${base}/`, { waitUntil: 'load' });

    const findings = createFindingCollector(join(dir, 'f.jsonl'), 'run-search');
    const bugs = fakeBugs();
    await runSearchCheck(page, bugs as any, 'desktop', { findings, runId: 'run-search' });

    // Bug stream unchanged.
    expect(bugs.collected.find((b) => b.ruleId === 'content:search-rendering-broken')).toBeDefined();

    // Finding stream additively gets the same issue.
    const f = findings.all().find((x) => x.ruleId === 'content:search-rendering-broken');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('high');
    expect(f!.category).toBe('content');
    expect(f!.source).toBe('deterministic');
    expect(f!.runId).toBe('run-search');

    await page.close();
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
    stopServer(server);
  }
});

test('search: without a dual-write context, only the bug stream is written (legacy 3-arg call)', async () => {
  const { server, base } = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.goto(`${base}/`, { waitUntil: 'load' });
    const bugs = fakeBugs();
    await runSearchCheck(page, bugs as any, 'desktop');
    expect(bugs.collected.find((b) => b.ruleId === 'content:search-rendering-broken')).toBeDefined();
    await page.close();
  } finally {
    await browser.close();
    stopServer(server);
  }
});
