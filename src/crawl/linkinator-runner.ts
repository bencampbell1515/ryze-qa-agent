import { check } from 'linkinator';
import type { BugInstance } from '../types.js';

const NOISE_DOMAINS = [
  'klaviyo.com',
  'gorgias.com',
  'facebook.com',
  'connect.facebook.net',
  'tiktok.com',
  'analytics.tiktok.com',
  'googletagmanager.com',
  'google-analytics.com',
  'doubleclick.net',
];

function isNoise(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return NOISE_DOMAINS.some((d) => host.endsWith(d));
  } catch {
    return false;
  }
}

/**
 * Run linkinator against the given URL recursively and return BugInstances
 * for every broken link found (status >= 400, excluding noise domains).
 */
export async function runLinkinator(startUrl: string): Promise<BugInstance[]> {
  const bugs: BugInstance[] = [];

  const result = await check({
    path: startUrl,
    recurse: false,
    timeout: 10_000,
    retryErrors: true,
    retryErrorsCount: 2,
    userAgent: 'RyzeQABot/0.1 (+pm@ryze.example)',
    linksToSkip: NOISE_DOMAINS,
  });

  for (const link of result.links) {
    if (link.state !== 'BROKEN') continue;
    if (isNoise(link.url)) continue;

    const status = link.status ?? 0;
    const severity = status >= 500 ? ('critical' as const) : ('high' as const);

    bugs.push({
      ruleId: `network:${status}`,
      severity,
      bugClass: 'network',
      message: `Broken link ${status}: ${link.url}`,
      url: startUrl,
      viewport: 'desktop',
      timestamp: new Date().toISOString(),
    });
  }

  return bugs;
}
