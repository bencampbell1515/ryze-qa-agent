// src/discovery/tools.ts
import { type Page } from '@playwright/test';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { DiscoveryFinding } from '../types.js';
import { enforceEvidence } from '../scoring/evidence-enforcer.js';

const ALLOWED_HOSTS = ['ryzesuperfoods.com', 'shop.ryzesuperfoods.com'];
const BLOCKED_PATHS = ['/admin', '/account/login', '/checkout'];

export interface NetworkEntry {
  url: string;
  status: number;
  method: string;
}

export interface ToolCallResult {
  [key: string]: unknown;
  error?: string;
}

export interface DiscoveryTools {
  definitions: Anthropic.Tool[];
  execute: (name: string, input: Record<string, unknown>) => Promise<ToolCallResult>;
  getVisitedUrls: () => string[];
}

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some(
    h => hostname === h || hostname === `www.${h}` || hostname.endsWith(`.${h}`)
  );
}

export function createTools(
  page: Page,
  opts: { screenshotsDir: string; discoveriesPath: string; personaName: string }
): DiscoveryTools {
  const { screenshotsDir, discoveriesPath, personaName } = opts;
  const visitedUrls: string[] = [];
  const networkLog: NetworkEntry[] = [];

  mkdirSync(screenshotsDir, { recursive: true });

  page.on('response', (response) => {
    networkLog.push({
      url: response.url(),
      status: response.status(),
      method: response.request().method(),
    });
  });

  async function navigate({ url }: { url: string }): Promise<ToolCallResult> {
    let parsed: URL;
    try { parsed = new URL(url); } catch {
      return { error: `Invalid URL: ${url}` };
    }
    if (!isAllowedHost(parsed.hostname)) {
      return { error: `Blocked: ${parsed.hostname} is not an allowed host` };
    }
    if (BLOCKED_PATHS.some(p => parsed.pathname.startsWith(p))) {
      return { error: `Blocked: ${parsed.pathname} is a restricted path` };
    }
    try {
      await page.waitForTimeout(1500);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const title = await page.title();
      if (!visitedUrls.includes(url)) visitedUrls.push(url);
      return { title, status: response?.status() ?? 0, url: page.url() };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async function screenshot({ viewport }: { viewport?: string }): Promise<ToolCallResult> {
    const slug = page.url()
      .replace(/https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 80);
    const filename = `${slug}-${viewport ?? 'desktop'}-${Date.now()}.png`;
    const path = join(screenshotsDir, filename);
    await page.screenshot({ path, fullPage: false });
    const base64 = readFileSync(path).toString('base64');
    return { path, base64 };
  }

  async function click({ selector }: { selector: string }): Promise<ToolCallResult> {
    const lower = selector.toLowerCase();
    if (lower.includes('checkout') || lower.includes('pay now') || lower.includes('complete order')) {
      return { error: 'Blocked: clicking checkout/payment submit buttons is not allowed' };
    }
    try {
      await page.locator(selector).first().click({ timeout: 10_000 });
      return { success: true };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async function scroll({ direction, px }: { direction: 'up' | 'down'; px?: number }): Promise<ToolCallResult> {
    const amount = px ?? 500;
    await page.evaluate(
      ({ dir, amt }: { dir: string; amt: number }) => { window.scrollBy(0, dir === 'down' ? amt : -amt); },
      { dir: direction, amt: amount }
    );
    return { success: true };
  }

  async function get_dom({ selector }: { selector?: string }): Promise<ToolCallResult> {
    try {
      if (selector) {
        const html = await page.locator(selector).first().innerHTML({ timeout: 5_000 });
        return { html: html.slice(0, 15_000) };
      }
      const html = await page.content();
      return { html: html.slice(0, 15_000) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async function get_network_log(): Promise<ToolCallResult> {
    return { requests: networkLog.slice(-15) };
  }

  async function wait_for({ selector, timeout }: { selector: string; timeout?: number }): Promise<ToolCallResult> {
    try {
      await page.locator(selector).first().waitFor({ timeout: timeout ?? 10_000 });
      return { found: true };
    } catch {
      return { found: false, timedOut: true };
    }
  }

  async function submit_finding(raw: Partial<DiscoveryFinding>): Promise<ToolCallResult> {
    const finding: Partial<DiscoveryFinding> = {
      ...raw,
      persona: personaName,
      timestamp: new Date().toISOString(),
    };
    const check = enforceEvidence(finding);
    if (!check.valid) return { accepted: false, rejectionReason: check.reason };
    if (!finding.severity || !finding.bugClass || !finding.ruleId) {
      return { accepted: false, rejectionReason: 'missing severity, bugClass, or ruleId' };
    }
    appendFileSync(discoveriesPath, JSON.stringify(finding) + '\n');
    return { accepted: true };
  }

  async function done(): Promise<ToolCallResult> {
    return { done: true };
  }

  const handlers: Record<string, (input: Record<string, unknown>) => Promise<ToolCallResult>> = {
    navigate: (i) => navigate(i as { url: string }),
    screenshot: (i) => screenshot(i as { viewport?: string }),
    click: (i) => click(i as { selector: string }),
    scroll: (i) => scroll(i as { direction: 'up' | 'down'; px?: number }),
    get_dom: (i) => get_dom(i as { selector?: string }),
    get_network_log: () => get_network_log(),
    wait_for: (i) => wait_for(i as { selector: string; timeout?: number }),
    submit_finding: (i) => submit_finding(i as Partial<DiscoveryFinding>),
    done: () => done(),
  };

  const definitions: Anthropic.Tool[] = [
    {
      name: 'navigate',
      description: 'Navigate to a URL on the Ryze website. Waits for DOM to load.',
      input_schema: {
        type: 'object' as const,
        properties: { url: { type: 'string', description: 'Full URL to navigate to' } },
        required: ['url'],
      },
    },
    {
      name: 'screenshot',
      description: 'Take a screenshot of the current page. You will see the image.',
      input_schema: {
        type: 'object' as const,
        properties: {
          viewport: { type: 'string', enum: ['desktop', 'tablet', 'mobile'], description: 'Label for the screenshot filename' },
        },
        required: [],
      },
    },
    {
      name: 'click',
      description: 'Click an element by CSS selector.',
      input_schema: {
        type: 'object' as const,
        properties: { selector: { type: 'string', description: 'CSS selector of element to click' } },
        required: ['selector'],
      },
    },
    {
      name: 'scroll',
      description: 'Scroll the page up or down.',
      input_schema: {
        type: 'object' as const,
        properties: {
          direction: { type: 'string', enum: ['up', 'down'] },
          px: { type: 'number', description: 'Pixels to scroll (default 500)' },
        },
        required: ['direction'],
      },
    },
    {
      name: 'get_dom',
      description: 'Get the HTML of the current page or a specific element.',
      input_schema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string', description: 'CSS selector for a specific element; omit for full page HTML' },
        },
        required: [],
      },
    },
    {
      name: 'get_network_log',
      description: 'Get the last 50 network requests captured on the current page.',
      input_schema: { type: 'object' as const, properties: {}, required: [] },
    },
    {
      name: 'wait_for',
      description: 'Wait for an element to appear in the DOM.',
      input_schema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' },
          timeout: { type: 'number', description: 'Milliseconds to wait (default 10000)' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'submit_finding',
      description: 'Submit a bug finding. All fields required. Writes to disk immediately.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'Exact page URL where the issue exists' },
          screenshot: { type: 'string', description: 'Path returned by a previous screenshot() call' },
          quotedElement: { type: 'string', description: 'Exact text or HTML of the broken element' },
          claim: { type: 'string', description: 'One sentence: what is wrong and why it matters' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          bugClass: {
            type: 'string',
            enum: ['revenue', 'a11y', 'network', 'visual', 'seo', 'content', 'console', 'lighthouse'],
          },
          ruleId: { type: 'string', description: 'Format: discovery:<slug>, e.g. discovery:fake-timer' },
        },
        required: ['url', 'screenshot', 'quotedElement', 'claim', 'severity', 'bugClass', 'ruleId'],
      },
    },
    {
      name: 'done',
      description: 'Signal that you have finished reviewing the current batch of URLs.',
      input_schema: { type: 'object' as const, properties: {}, required: [] },
    },
  ];

  return {
    definitions,
    execute: async (name, input) => {
      const handler = handlers[name];
      if (!handler) return { error: `Unknown tool: ${name}` };
      return handler(input);
    },
    getVisitedUrls: () => [...visitedUrls],
  };
}
