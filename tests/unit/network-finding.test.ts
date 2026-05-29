import { test, expect, chromium } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachNetworkListeners } from '../checks/network.js';
import { createFindingCollector } from '../../src/findings/index.js';
import type { BugInstance } from '../../src/types.js';

function fakeBugs() {
  const collected: Array<Omit<BugInstance, 'timestamp'>> = [];
  return { collected, add: (b: Omit<BugInstance, 'timestamp'>) => collected.push(b) };
}

/**
 * Serve an HTML page whose <img> points at a path that returns HTTP 404. The
 * response listener attachNetworkListeners installs fires `network:404`. The
 * loopback server keeps the URL on 127.0.0.1 so it isn't filtered as noise.
 */
const PAGE_HTML =
  '<!DOCTYPE html><html><body><img src="/missing.png"></body></html>';

function startServer(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url && req.url.includes('missing.png')) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(PAGE_HTML);
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

test('network: dual-write emits a Finding alongside the network:404 bug', async () => {
  const { server, base } = await startServer();
  const dir = mkdtempSync(join(tmpdir(), 'ryze-net-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });

    const findings = createFindingCollector(join(dir, 'f.jsonl'), 'run-net');
    const bugs = fakeBugs();
    attachNetworkListeners(page, bugs as any, 'desktop', { findings, runId: 'run-net' });

    await page.goto(`${base}/`, { waitUntil: 'load' });
    // Give the response listener a beat to fire for the image request.
    await page.waitForTimeout(500).catch(() => {});

    // Bug stream unchanged: the 404 bug is still emitted.
    expect(bugs.collected.find((b) => b.ruleId === 'network:404')).toBeDefined();

    // Finding stream additively gets the same issue.
    const f = findings.all().find((x) => x.ruleId === 'network:404');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('high');
    expect(f!.category).toBe('network');
    expect(f!.source).toBe('deterministic');
    expect(f!.runId).toBe('run-net');

    await page.close();
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
    stopServer(server);
  }
});

test('network: without a dual-write context, only the bug stream is written (legacy 3-arg call)', async () => {
  const { server, base } = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    const bugs = fakeBugs();
    attachNetworkListeners(page, bugs as any, 'desktop');
    await page.goto(`${base}/`, { waitUntil: 'load' });
    await page.waitForTimeout(500).catch(() => {});
    expect(bugs.collected.find((b) => b.ruleId === 'network:404')).toBeDefined();
    await page.close();
  } finally {
    await browser.close();
    stopServer(server);
  }
});
