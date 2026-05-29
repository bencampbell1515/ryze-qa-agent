import { test, expect, chromium } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRevenueCheck } from '../checks/revenue.js';
import { createFindingCollector } from '../../src/findings/index.js';
import type { BugInstance } from '../../src/types.js';

function fakeBugs() {
  const collected: Array<Omit<BugInstance, 'timestamp'>> = [];
  return { collected, add: (b: Omit<BugInstance, 'timestamp'>) => collected.push(b) };
}

/**
 * Serve a /cart page with a visible line item, a PRESENT subtotal, and a
 * present-but-DISABLED checkout button. runRevenueCheck takes the `/cart`
 * branch → runCartChecks directly, avoiding the ATC sample flow (and its 35s
 * race timer, never cleared on the happy path).
 *
 * Every element runCartChecks queries by `.textContent()` either exists
 * (subtotal, checkout) — so Playwright never hits its 30s auto-wait — or is
 * probed via `.isVisible()` (qty/discount/note/remove controls), which returns
 * immediately. Net result: exactly one fast, deterministic bug,
 * revenue:checkout-disabled.
 *
 * The URL must literally contain `/cart` for the branch to fire, so a real
 * loopback server is used rather than page.setContent (about:blank fails the
 * gate).
 */
const CART_HTML =
  '<!DOCTYPE html><html><body>' +
  '<div class="cart-item" style="display:block;width:240px;height:48px">' +
  '<a href="/products/mushroom-coffee">Mushroom Coffee</a></div>' +
  '<div data-cart-subtotal style="display:block">$30.00</div>' +
  '<button name="checkout" disabled>Checkout</button>' +
  '</body></html>';

function startServer(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(CART_HTML);
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

test('revenue: dual-write emits a Finding alongside the cart-subtotal bug', async () => {
  const { server, base } = await startServer();
  const dir = mkdtempSync(join(tmpdir(), 'ryze-rev-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    page.setDefaultTimeout(2000); // belt-and-suspenders against any negative auto-wait
    await page.goto(`${base}/cart`, { waitUntil: 'load' });

    const findings = createFindingCollector(join(dir, 'f.jsonl'), 'run-rev');
    const bugs = fakeBugs();
    await runRevenueCheck(page, bugs as any, 'desktop', { findings, runId: 'run-rev' });

    // Bug stream unchanged: the checkout-disabled bug is still emitted.
    expect(bugs.collected.find((b) => b.ruleId === 'revenue:checkout-disabled')).toBeDefined();

    // Finding stream additively gets the same issue.
    const f = findings.all().find((x) => x.ruleId === 'revenue:checkout-disabled');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('critical');
    expect(f!.category).toBe('revenue');
    expect(f!.source).toBe('deterministic');
    expect(f!.runId).toBe('run-rev');
    expect(f!.title).toBe('Checkout button disabled on cart');

    await page.close();
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
    stopServer(server);
  }
});

test('revenue: without a dual-write context, only the bug stream is written (legacy 3-arg call)', async () => {
  const { server, base } = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    page.setDefaultTimeout(2000);
    await page.goto(`${base}/cart`, { waitUntil: 'load' });

    const bugs = fakeBugs();
    await runRevenueCheck(page, bugs as any, 'desktop');
    expect(bugs.collected.find((b) => b.ruleId === 'revenue:checkout-disabled')).toBeDefined();

    await page.close();
  } finally {
    await browser.close();
    stopServer(server);
  }
});
