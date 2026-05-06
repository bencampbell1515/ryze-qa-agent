import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport, Severity } from '../../src/types.js';

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
];

const NOISE_URL_PATTERNS = ['/em-cgi/', '/em-js/', '/em-prerender'];

const NOISE_404_URL_PATTERNS = [
  /\/em-prerender/,
  /\/em-cgi\//,
  /\/em-js\//,
  /cdn\.shopify\.com\/s\/files\/.*\/t\/(?!2676\/)[0-9]+\//,
  /\/t\?event=/,
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
): void {
  page.on('requestfailed', (req) => {
    if (isNoise(req.url(), undefined)) return;
    const errText = req.failure()?.errorText ?? 'unknown';
    if (errText.includes('ERR_ABORTED')) return; // request cancelled during navigation
    bugs.add({
      ruleId: 'network:failed',
      severity: 'high',
      bugClass: 'network',
      message: `Request failed: ${req.url()} (${errText})`,
      url: page.url(),
      viewport,
    });
  });

  page.on('response', (res) => {
    if (res.status() < 400) return;
    if (isNoise(res.url(), res.status())) return;
    const severity: Severity = res.status() >= 500 ? 'critical' : 'high';
    bugs.add({
      ruleId: `network:${res.status()}`,
      severity,
      bugClass: 'network',
      message: `HTTP ${res.status()}: ${res.url()}`,
      url: page.url(),
      viewport,
    });
  });
}
