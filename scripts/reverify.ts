// scripts/reverify.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import type { ScoredBug, VerificationStatus } from '../src/types.js';

const SCORED_PATH = join(process.cwd(), 'data', 'scored-bugs.json');
const TOP_N = 10;
const NAV_TIMEOUT = 30_000;

async function verifyBug(page: import('@playwright/test').Page, bug: ScoredBug): Promise<VerificationStatus> {
  try {
    await page.goto(bug.urls[0], { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });

    if (bug.ruleId.startsWith('network:404')) {
      const url = bug.description.match(/https?:\/\/\S+/)?.[0];
      if (!url) return 'inconclusive';
      const response = await page.request.get(url, { timeout: 10_000 }).catch(() => null);
      if (!response) return 'inconclusive';
      return response.status() === 404 ? 'confirmed' : 'could-not-reproduce';
    }

    if (bug.ruleId.startsWith('a11y:') && bug.selector) {
      const el = page.locator(bug.selector).first();
      const visible = await el.isVisible().catch(() => false);
      return visible ? 'confirmed' : 'could-not-reproduce';
    }

    if (bug.ruleId.startsWith('revenue:')) {
      const atcSelectors = ['button[name="add"]', 'button:has-text("Add to Cart")', 'button:has-text("Subscribe")'];
      for (const sel of atcSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 5_000 }).catch(() => false)) return 'could-not-reproduce';
      }
      return 'confirmed';
    }

    return 'inconclusive';
  } catch {
    return 'inconclusive';
  }
}

async function main(): Promise<void> {
  if (!existsSync(SCORED_PATH)) {
    console.warn('data/scored-bugs.json not found — skipping re-verification.');
    return;
  }

  const bugs: ScoredBug[] = JSON.parse(readFileSync(SCORED_PATH, 'utf8'));
  const topBugs = bugs.slice(0, TOP_N);

  console.log(`Re-verifying top ${topBugs.length} findings...`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();

  try {
    for (const bug of topBugs) {
      process.stdout.write(`  → [${bug.score.toFixed(1)}] ${bug.ruleId} @ ${bug.urls[0]}... `);
      const status = await verifyBug(page, bug);
      bug.verificationStatus = status;

      // Capture element screenshot for bugs with a known selector
      if (bug.selector) {
        try {
          const el = page.locator(bug.selector).first();
          const visible = await el.isVisible({ timeout: 3_000 }).catch(() => false);
          if (visible) {
            const shotDir = join(process.cwd(), 'output', 'screenshots');
            mkdirSync(shotDir, { recursive: true });
            const shotPath = join(shotDir, `${bug.fingerprint}-element.png`);
            await el.screenshot({ path: shotPath });
            bug.elementShot = shotPath;
          }
        } catch {
          // non-blocking — report build falls back gracefully
        }
      }

      const icon = status === 'confirmed' ? '✅' : status === 'could-not-reproduce' ? '❌' : '❓';
      console.log(`${icon} ${status}`);
    }
  } finally {
    await browser.close();
  }

  writeFileSync(SCORED_PATH, JSON.stringify(bugs, null, 2));
  console.log('Re-verification complete.');
}

main().catch((err) => {
  console.error('Re-verification pass failed:', err);
  process.exit(1);
});
