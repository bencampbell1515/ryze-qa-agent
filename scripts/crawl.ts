import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { discoverUrls } from '../src/crawl/sitemap.js';

const URL_LIST_PATH = join(process.cwd(), 'output', 'url-list.json');
mkdirSync(join(process.cwd(), 'output'), { recursive: true });

console.log('Fetching sitemaps...');
const urlList = await discoverUrls();

const total = Object.values(urlList).reduce((s, a) => s + a.length, 0);
console.log(`\nDiscovered ${total} URLs:`);
for (const [category, urls] of Object.entries(urlList)) {
  if (urls.length > 0) console.log(`  ${category}: ${urls.length}`);
}

writeFileSync(URL_LIST_PATH, JSON.stringify(urlList, null, 2));
console.log(`\nWritten to ${URL_LIST_PATH}`);
