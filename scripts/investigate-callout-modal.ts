import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const URL = 'https://www.ryzesuperfoods.com/products/mushroom-coffee';
mkdirSync('output/modal-investigation', { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const card = document.querySelector('.CalloutCard');
    if (!card) return { found: false };

    // Get all links and buttons with their full href
    const links = Array.from(card.querySelectorAll('a')).map(a => ({
      text: a.innerText.trim(),
      href: a.getAttribute('href'),
      resolvedHref: a.href,
      classes: a.className,
    }));

    // Get the GIF/video/img sources
    const media = Array.from(card.querySelectorAll('img, video, source')).map(el => ({
      tag: el.tagName,
      src: (el as HTMLImageElement).src || (el as HTMLSourceElement).src || '',
      type: (el as HTMLSourceElement).type || '',
    }));

    return { found: true, links, media };
  });

  console.log('\n=== CalloutCard links ===');
  (info as any).links?.forEach((l: any) => {
    console.log(`  text: "${l.text}"`);
    console.log(`  href attr: "${l.href}"`);
    console.log(`  resolved: "${l.resolvedHref}"`);
    console.log(`  classes: ${l.classes}`);
    console.log();
  });

  console.log('=== CalloutCard media ===');
  (info as any).media?.forEach((m: any) => console.log(`  ${m.tag}: ${m.src}`));

  await browser.close();
})();
