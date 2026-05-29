import { test, expect, chromium } from '@playwright/test';
import { runOpenGraphCheck } from '../checks/opengraph.js';
import { createFindingCollector } from '../../src/findings/index.js';

const fakeBugs = () => {
  const collected: any[] = [];
  return { collected, add: (b: any) => collected.push(b) };
};

test('opengraph: missing og:title → seo:og-missing', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><head>
    <meta property="og:description" content="A description" />
    <meta property="og:image" content="https://example.com/img.jpg" />
    <meta property="og:url" content="https://example.com/" />
    <meta property="og:type" content="website" />
  </head><body></body></html>`);
  const bugs = fakeBugs();
  const findings = createFindingCollector(undefined, 'run-og'); // in-memory; never flushed
  await runOpenGraphCheck(page, bugs as any, 'desktop', { findings, runId: 'run-og' });
  const missing = bugs.collected.find((b: any) => b.ruleId === 'seo:og-missing' && b.message.includes('og:title'));
  expect(missing).toBeDefined();
  // worktree M2 dual-write: the same issue lands in the Finding stream.
  expect(findings.all().find((f) => f.ruleId === 'seo:og-missing')).toBeDefined();
  await browser.close();
});

test('opengraph: all required OG tags present on non-PDP → no bug', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><head>
    <meta property="og:title" content="Home Page" />
    <meta property="og:description" content="A description" />
    <meta property="og:image" content="https://example.com/img.jpg" />
    <meta property="og:url" content="https://example.com/" />
    <meta property="og:type" content="website" />
  </head><body></body></html>`);
  const bugs = fakeBugs();
  await runOpenGraphCheck(page, bugs as any, 'desktop');
  expect(bugs.collected).toHaveLength(0);
  await browser.close();
});

test('opengraph: empty og:image content → seo:og-missing', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><head>
    <meta property="og:title" content="Home Page" />
    <meta property="og:description" content="A description" />
    <meta property="og:image" content="" />
    <meta property="og:url" content="https://example.com/" />
    <meta property="og:type" content="website" />
  </head><body></body></html>`);
  const bugs = fakeBugs();
  await runOpenGraphCheck(page, bugs as any, 'desktop');
  const missing = bugs.collected.find((b: any) => b.ruleId === 'seo:og-missing' && b.message.includes('og:image'));
  expect(missing).toBeDefined();
  await browser.close();
});

test('opengraph: PDP with og:type=product → no type bug', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const html = `<!DOCTYPE html><html><head>
    <meta property="og:title" content="RYZE Coffee" />
    <meta property="og:description" content="A description" />
    <meta property="og:image" content="https://example.com/img.jpg" />
    <meta property="og:url" content="https://example.com/products/ryze-coffee" />
    <meta property="og:type" content="product" />
  </head><body></body></html>`;
  await page.route('https://example.com/products/ryze-coffee', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://example.com/products/ryze-coffee');
  const bugs = fakeBugs();
  await runOpenGraphCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'seo:og-wrong-type')).toBeUndefined();
  await browser.close();
});

test('opengraph: PDP with og:type=website → seo:og-wrong-type', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const html = `<!DOCTYPE html><html><head>
    <meta property="og:title" content="RYZE Coffee" />
    <meta property="og:description" content="A description" />
    <meta property="og:image" content="https://example.com/img.jpg" />
    <meta property="og:url" content="https://example.com/products/ryze-coffee" />
    <meta property="og:type" content="website" />
  </head><body></body></html>`;
  await page.route('https://example.com/products/ryze-coffee-website', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://example.com/products/ryze-coffee-website');
  const bugs = fakeBugs();
  await runOpenGraphCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'seo:og-wrong-type')).toBeDefined();
  await browser.close();
});

test('opengraph: multiple missing tags → multiple seo:og-missing bugs', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><head></head><body></body></html>`);
  const bugs = fakeBugs();
  await runOpenGraphCheck(page, bugs as any, 'desktop');
  const missing = bugs.collected.filter((b: any) => b.ruleId === 'seo:og-missing');
  // All 5 required tags are missing
  expect(missing.length).toBe(5);
  await browser.close();
});
