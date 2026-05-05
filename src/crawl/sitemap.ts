import { XMLParser } from 'fast-xml-parser';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const robotsParser = require('robots-parser') as (url: string, txt: string) => { isAllowed(url: string, ua?: string): boolean | undefined };
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
  if (pathname.startsWith('/blogs/') && pathname.split('/').filter(Boolean).length >= 3) return 'blog';
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
 * Applies robots.txt filtering for RyzeQABot/0.1 before adding any URL.
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

  // Build robots.txt map for each unique host in SITEMAP_URLS
  type RobotsInstance = ReturnType<typeof robotsParser>;
  const robotsMap = new Map<string, RobotsInstance>();
  for (const sitemapUrl of SITEMAP_URLS) {
    const { hostname, origin } = new URL(sitemapUrl);
    if (robotsMap.has(hostname)) continue;
    const robotsTxtUrl = `${origin}/robots.txt`;
    try {
      const txt = await curlFetch(robotsTxtUrl);
      robotsMap.set(hostname, robotsParser(robotsTxtUrl, txt));
    } catch (err) {
      console.warn(`robots.txt fetch failed for ${hostname}: ${(err as Error).message}`);
    }
  }

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

    let locs: string[];
    try {
      locs = parseLocUrls(xml);
    } catch (err) {
      console.warn(`Failed to parse sitemap XML from ${url}: ${(err as Error).message}`);
      continue;
    }

    for (const loc of locs) {
      // Guard against relative/empty <loc> values
      if (!URL.canParse(loc)) continue;

      // If it's a sub-sitemap (pathname ends with .xml), add to queue
      if (new URL(loc).pathname.endsWith('.xml')) {
        queue.push(loc);
        continue;
      }

      const category = categorize(loc);
      if (!category) continue;

      // robots.txt filtering
      const robotsForHost = robotsMap.get(new URL(loc).hostname);
      if (robotsForHost && !robotsForHost.isAllowed(loc, 'RyzeQABot/0.1')) continue;

      // Blog sample cap: check before adding, increment only when actually adding
      if (category === 'blog') {
        const host = new URL(loc).hostname;
        if ((blogCounts[host] ?? 0) >= BLOG_SAMPLE_LIMIT) continue;
      }

      if (!result[category].includes(loc)) {
        result[category].push(loc);
        if (category === 'blog') {
          const host = new URL(loc).hostname;
          blogCounts[host] = (blogCounts[host] ?? 0) + 1;
        }
      }
    }
  }

  return result;
}
