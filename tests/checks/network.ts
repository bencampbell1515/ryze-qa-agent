import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport, Severity } from '../../src/types.js';

const NOISE_HOSTS = [
  'klaviyo.com', 'gorgias.com', 'connect.facebook.net',
  'facebook.com', 'analytics.tiktok.com', 'tiktok.com',
  'googletagmanager.com', 'google-analytics.com', 'doubleclick.net',
];

function isNoise(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return NOISE_HOSTS.some((d) => host.endsWith(d));
  } catch { return false; }
}

export function attachNetworkListeners(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
): void {
  page.on('requestfailed', (req) => {
    if (isNoise(req.url())) return;
    bugs.add({
      ruleId: 'network:failed',
      severity: 'high',
      bugClass: 'network',
      message: `Request failed: ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`,
      url: page.url(),
      viewport,
    });
  });

  page.on('response', (res) => {
    if (res.status() < 400) return;
    if (isNoise(res.url())) return;
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
