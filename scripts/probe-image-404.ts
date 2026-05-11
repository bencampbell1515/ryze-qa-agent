// Smoke test for tests/checks/image.ts — loads the known-bad URL and asserts
// the new check fires. Also re-prints the request-level 404 for context.
import { chromium } from '@playwright/test';
import { runImageCheck } from '../tests/checks/image.js';

const URL = process.argv[2] || 'https://www.ryzesuperfoods.com/pages/mushroom-dark-roast-espanol';
const PATTERN = /cdn\/shop\/files\/\?v=/;

class InMemoryBugs {
  bugs: any[] = [];
  add(b: any) { this.bugs.push({ ...b, timestamp: new Date().toISOString() }); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    userAgent: 'RyzeQABot/0.1 (+pm@ryze.example)',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');

  const failedReqs: { url: string; status: number }[] = [];
  const byReq = new Map<string, string>();
  cdp.on('Network.requestWillBeSent', (e: any) => {
    if (PATTERN.test(e.request.url)) byReq.set(e.requestId, e.request.url);
  });
  cdp.on('Network.responseReceived', (e: any) => {
    const u = byReq.get(e.requestId);
    if (u && e.response.status >= 400) failedReqs.push({ url: u, status: e.response.status });
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8000);

  const collector = new InMemoryBugs();
  await runImageCheck(page, collector as any, 'desktop');

  console.log('\n=== Network failures matching broken-template pattern ===');
  for (const f of failedReqs) console.log(`  ${f.status}  ${f.url}`);

  console.log(`\n=== runImageCheck fired ${collector.bugs.length} bug(s) ===\n`);
  for (const b of collector.bugs) {
    console.log(`[${b.severity.toUpperCase()}] ${b.ruleId}`);
    console.log('  message: ', b.message);
    console.log('  selector:', b.selector);
    console.log('  outer:   ', b.outerHTMLSnippet);
    console.log('---');
  }

  await browser.close();

  // Exit code reflects whether the check fired at least once on the known-bad page.
  process.exit(collector.bugs.length > 0 ? 0 : 1);
})();
