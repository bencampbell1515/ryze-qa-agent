import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport, Severity } from '../../src/types.js';
import { emitBug, type DualWriteContext } from './_emit.js';

const NOISE_HOSTS = [
  'klaviyo.com', 'gorgias.com', 'connect.facebook.net',
  'facebook.com', 'analytics.tiktok.com', 'tiktok.com',
  'googletagmanager.com', 'google-analytics.com', 'doubleclick.net',
  'snapchat.com', 'trkn.us', 'shoplift.ai', 't.vibe.co',
  'monorail-edge.shopifysvc.com',
  'applovin.com', 'sentry.io', 'postscript.io', 'clarity.ms',
  'mountain.com', 'launchdarkly.com', 'segment.com', 'amplitude.com',
  'intercom.io', 'hotjar.com', 'zendesk.com',
  'otlp-http-production.shopifysvc.com',
  'id.ryzesuperfoods.com',
  'api.rechargeapps.com',
  'myshopify.com',
  // NOISE-HULK: HulkApps form-builder's WAF 403s the RyzeQABot UA. Verified
  // (2026-05-12) the same /corepage/customform endpoints return 200 with a
  // normal browser UA — the form works for real users. Filtering the whole
  // host since every hulkapps subresource has the same UA gate.
  'hulkapps.com',
];

const NOISE_URL_PATTERNS = ['/em-cgi/', '/em-js/', '/em-prerender'];

const NOISE_404_URL_PATTERNS = [
  /\/em-prerender/,
  /\/em-cgi\//,
  /\/em-js\//,
  /cdn\.shopify\.com\/s\/files\/.*\/t\/(?!2676\/)[0-9]+\//,
  /\/t\?event=/,
  // Liquid template errors render the error string as a URL (e.g.
  // /products/Liquid%20error%20(sections/callout-card%20line%2089):%20invalid%20url%20input).
  // These are known theme bugs tracked separately; suppress so they don't
  // dominate the 404 report. Matches both raw and URL-encoded forms.
  /Liquid(\s|%20|\+)error/i,
];

function isNoise(url: string, statusCode?: number): boolean {
  try {
    const host = new URL(url).hostname;
    if (NOISE_HOSTS.some((d) => host.endsWith(d))) return true;
    if (NOISE_URL_PATTERNS.some((p) => url.includes(p))) return true;
    if (statusCode === 404 && NOISE_404_URL_PATTERNS.some((p) => p.test(url))) return true;
    return false;
  } catch { return false; }
}

export function attachNetworkListeners(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
  ctx?: DualWriteContext,
): void {
  page.on('requestfailed', (req) => {
    if (isNoise(req.url(), undefined)) return;
    const errText = req.failure()?.errorText ?? 'unknown';
    if (errText.includes('ERR_ABORTED')) return; // request cancelled during navigation
    emitBug(bugs, ctx, {
      ruleId: 'network:failed',
      severity: 'high',
      bugClass: 'network',
      message: `Request failed: ${req.url()} (${errText})`,
      url: page.url(),
      viewport,
    }, { title: 'Network request failed' });
  });

  page.on('response', (res) => {
    if (res.status() < 400) return;
    if (isNoise(res.url(), res.status())) return;
    const severity: Severity = res.status() >= 500 ? 'critical' : 'high';
    emitBug(bugs, ctx, {
      ruleId: `network:${res.status()}`,
      severity,
      bugClass: 'network',
      message: `HTTP ${res.status()}: ${res.url()}`,
      url: page.url(),
      viewport,
    }, { title: `HTTP ${res.status()} response` });
  });
}
