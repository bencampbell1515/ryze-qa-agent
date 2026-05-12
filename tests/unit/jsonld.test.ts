import { test, expect, chromium } from '@playwright/test';
import { runJsonLdCheck } from '../checks/jsonld.js';

const fakeBugs = () => {
  const collected: any[] = [];
  return { collected, add: (b: any) => collected.push(b) };
};

test('jsonld: parse failure → seo:jsonld-malformed', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><head><script type="application/ld+json">{ not valid json</script></head><body></body></html>`);
  const bugs = fakeBugs();
  await runJsonLdCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'seo:jsonld-malformed')).toBeDefined();
  await browser.close();
});

test('jsonld: missing @context → seo:jsonld-missing-context', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><head><script type="application/ld+json">{"@type":"WebPage","name":"Test"}</script></head><body></body></html>`);
  const bugs = fakeBugs();
  await runJsonLdCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'seo:jsonld-missing-context')).toBeDefined();
  await browser.close();
});

test('jsonld: valid non-PDP page with proper schema → no bug', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', 'name': 'Home' });
  await page.setContent(`<!DOCTYPE html><html><head><script type="application/ld+json">${ld}</script></head><body></body></html>`);
  const bugs = fakeBugs();
  await runJsonLdCheck(page, bugs as any, 'desktop');
  expect(bugs.collected).toHaveLength(0);
  await browser.close();
});

test('jsonld: PDP with no Product schema → seo:jsonld-product-incomplete', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', 'name': 'A Page' });
  const html = `<!DOCTYPE html><html><head><script type="application/ld+json">${ld}</script></head><body></body></html>`;
  // Use route to serve a real-looking PDP URL
  await page.route('https://example.com/products/my-product', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://example.com/products/my-product');
  const bugs = fakeBugs();
  await runJsonLdCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'seo:jsonld-product-incomplete')).toBeDefined();
  await browser.close();
});

test('jsonld: PDP with complete Product schema → no product bug', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    'name': 'RYZE Mushroom Coffee',
    'image': 'https://example.com/image.jpg',
    'offers': {
      '@type': 'Offer',
      'price': '30.00',
      'priceCurrency': 'USD',
    },
  });
  const html = `<!DOCTYPE html><html><head><script type="application/ld+json">${ld}</script></head><body></body></html>`;
  await page.route('https://example.com/products/ryze-mushroom-coffee', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://example.com/products/ryze-mushroom-coffee');
  const bugs = fakeBugs();
  await runJsonLdCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.filter((b: any) => b.ruleId === 'seo:jsonld-product-incomplete')).toHaveLength(0);
  await browser.close();
});

test('jsonld: PDP with Product missing price → seo:jsonld-product-incomplete', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    'name': 'RYZE Mushroom Coffee',
    'image': 'https://example.com/image.jpg',
    'offers': {
      '@type': 'Offer',
      'priceCurrency': 'USD',
    },
  });
  const html = `<!DOCTYPE html><html><head><script type="application/ld+json">${ld}</script></head><body></body></html>`;
  await page.route('https://example.com/products/ryze-mushroom-coffee-noprice', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://example.com/products/ryze-mushroom-coffee-noprice');
  const bugs = fakeBugs();
  await runJsonLdCheck(page, bugs as any, 'desktop');
  expect(bugs.collected.find((b: any) => b.ruleId === 'seo:jsonld-product-incomplete' && b.message.includes('price'))).toBeDefined();
  await browser.close();
});
