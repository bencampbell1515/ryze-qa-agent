import { XMLParser } from 'fast-xml-parser';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { UrlList } from '../types.js';

const execFileAsync = promisify(execFile);

const SITEMAP_URLS = [
  'https://www.ryzesuperfoods.com/sitemap.xml',
  'https://shop.ryzesuperfoods.com/sitemap.xml',
];

const BLOG_SAMPLE_LIMIT = 20;

/** Parse a single sitemap XML string, returning all <loc> URLs. */
function parseLocUrls(xml: string): string[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const urls: string[] = [];

  // Handle sitemap index (list of sitemaps)
  const sitemapIndex = doc['sitemapindex'] as
    | { sitemap: Array<{ loc: string }> | { loc: string } }
    | undefined;
  if (sitemapIndex?.sitemap) {
    const sitemaps = Array.isArray(sitemapIndex.sitemap)
      ? sitemapIndex.sitemap
      : [sitemapIndex.sitemap];
    for (const s of sitemaps) urls.push(s.loc);
    return urls;
  }

  // Handle regular urlset
  const urlset = doc['urlset'] as
    | { url: Array<{ loc: string }> | { loc: string } }
    | undefined;
  if (urlset?.url) {
    const entries = Array.isArray(urlset.url) ? urlset.url : [urlset.url];
    for (const u of entries) urls.push(u.loc);
  }
  return urls;
}

/** Categorize a URL into one of the UrlList keys. */
function categorize(url: string): keyof UrlList | null {
  const { pathname } = new URL(url);
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname.startsWith('/products/')) return 'product';
  if (pathname.startsWith('/collections/')) return 'collection';
  if (pathname.startsWith('/pages/')) return 'page';
  if (pathname.startsWith('/blogs/') && pathname.split('/').length >= 4) return 'blog';
  if (pathname === '/cart') return 'cart';
  if (pathname.startsWith('/policies/')) return 'policy';
  return null;
}

/**
 * Fetch URL body via curl -sL, which handles Edgemesh's cookie-based redirect
 * challenge that Node.js fetch cannot pass (TLS fingerprint discrimination).
 */
async function curlFetch(url: string): Promise<string> {
  const { stdout } = await execFileAsync('curl', [
    '-sL',
    '--max-redirs', '20',
    '-A', 'RyzeQABot/0.1 (+pm@ryze.example)',
    '--fail-with-body',
    url,
  ]);
  return stdout;
}

/**
 * Fetch sitemaps for both RYZE sites, categorize URLs, and return the UrlList.
 * Caller is responsible for robots.txt filtering (use robots-parser).
 */
export async function discoverUrls(): Promise<UrlList> {
  const result: UrlList = {
    home: [],
    product: [],
    collection: [],
    page: [],
    blog: [],
    cart: [],
    policy: [],
  };

  const queue: string[] = [...SITEMAP_URLS];
  const visited = new Set<string>();
  const blogCounts: Record<string, number> = {};

  while (queue.length > 0) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    let xml: string;
    try {
      xml = await curlFetch(url);
    } catch (err) {
      console.warn(`Sitemap fetch failed: ${url} → ${(err as Error).message}`);
      continue;
    }
    const locs = parseLocUrls(xml);

    for (const loc of locs) {
      // If it's a sitemap index entry, add to queue
      if (loc.endsWith('.xml') || loc.includes('sitemap')) {
        queue.push(loc);
        continue;
      }
      const category = categorize(loc);
      if (!category) continue;

      if (category === 'blog') {
        const host = new URL(loc).hostname;
        blogCounts[host] = (blogCounts[host] ?? 0) + 1;
        if (blogCounts[host] > BLOG_SAMPLE_LIMIT) continue;
      }

      if (!result[category].includes(loc)) {
        result[category].push(loc);
      }
    }
  }

  return result;
}
