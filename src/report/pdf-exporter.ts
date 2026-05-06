import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';

export async function exportPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });

    await page.addStyleTag({
      content: `
        .tabs { display: none !important; }
        #view-category { display: none !important; }
        #view-severity { display: block !important; }
        .url-overflow { display: block !important; }
        .show-more-btn { display: none !important; }
      `,
    });

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '1.2cm', bottom: '1.2cm', left: '1.2cm', right: '1.2cm' },
    });
  } finally {
    await browser.close();
  }
}
