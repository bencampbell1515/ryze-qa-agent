/**
 * LOCAL STUB of `src/cross-page/links-journey-helper.ts` (delivered by worktree B).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * Worktree E (journey tests) depends on worktree B's `checkLinksInContainer`
 * to validate links extracted from a journey-specific DOM container (e.g. the
 * checkout disclaimer). As of this worktree, B has NOT yet merged to main —
 * `src/cross-page/links-journey-helper.ts` does not exist. Importing a missing
 * module would break `tsc` and Playwright collection, so we ship a local,
 * functional stub that matches B's published signature exactly.
 *
 * ── SIGNATURE PARITY (do not drift) ───────────────────────────────────────
 * Per tasks/worktree-B-link-integrity.md, B's helper is:
 *
 *   export async function checkLinksInContainer(
 *     page: Page,
 *     containerSelector: string,
 *     runId: string,
 *     contextLabel: string  // e.g. "checkout-disclaimer", goes into meta.context
 *   ): Promise<Finding[]>;
 *
 * The findings it emits use ruleId `cross-page:broken-link` (or
 * `cross-page:broken-fragment` for anchor-only failures), source `cross-page`,
 * confidence 1.0, and a pre-confirmed visualGate.
 *
 * ── HOW TO SWAP WHEN B MERGES ─────────────────────────────────────────────
 * Replace the body of this file with a single re-export:
 *
 *   export { checkLinksInContainer } from '../../src/cross-page/links-journey-helper.js';
 *   export type { ... } from '../../src/cross-page/links-journey-helper.js';
 *
 * The journey specs import from `./_links-journey-helper.js`, so swapping here
 * is the only change required.
 *
 * ── STUB BEHAVIOR vs B's REAL IMPL ────────────────────────────────────────
 * B validates links by shelling out to the `lychee` CLI (with anchor-fragment
 * support + caching). This stub validates each link in-process using the
 * browser context's APIRequestContext (`page.context().request`) which reuses
 * the Cloudflare-O2O-trusted Chrome session's cookies. That is "good enough"
 * to catch a hard 404 (the motivating checkout privacy-policy bug) but does
 * NOT verify anchor fragments. Fragment links are reported as `skipped` rather
 * than guessed at. The real helper supersedes all of this.
 */

import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { Finding } from '../../src/types/finding.js';

/** Statuses we treat as healthy (mirrors B's lychee `--accept` set). */
const ACCEPTED_STATUSES = new Set([200, 201, 202, 203, 204, 301, 302, 304, 307, 308]);

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

function shortHash(input: string): string {
  return sha1(input).slice(0, 10);
}

/**
 * Extract, dedupe, and validate every link inside `containerSelector`, then
 * return one Finding per broken link. Mirrors worktree B's contract.
 */
export async function checkLinksInContainer(
  page: Page,
  containerSelector: string,
  runId: string,
  contextLabel: string,
): Promise<Finding[]> {
  const container = page.locator(containerSelector).first();
  if ((await container.count().catch(() => 0)) === 0) {
    return [];
  }

  // Extract hrefs + accessible text from anchors inside the container.
  const anchors = container.locator('a[href]');
  const anchorCount = await anchors.count().catch(() => 0);

  const seen = new Set<string>();
  const links: { href: string; text: string }[] = [];
  for (let i = 0; i < anchorCount; i++) {
    const a = anchors.nth(i);
    const href = (await a.getAttribute('href').catch(() => null))?.trim();
    if (!href) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const text = ((await a.textContent().catch(() => '')) ?? '').trim();
    links.push({ href, text });
  }

  const pageUrl = page.url();
  const findings: Finding[] = [];

  for (const { href, text } of links) {
    // Resolve relative URLs against the current page.
    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      continue; // unparseable (e.g. mailto:, tel:, javascript:) — not a broken link
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      continue; // mailto:/tel:/javascript: are out of scope for HTTP validation
    }

    const isFragmentOnly = href.startsWith('#');
    if (isFragmentOnly) {
      // The stub cannot verify in-page anchors; B's lychee impl does. Skip.
      continue;
    }

    let status: number | null = null;
    let error = '';
    try {
      const resp = await page.context().request.get(resolved.toString(), {
        maxRedirects: 5,
        timeout: 15_000,
      });
      status = resp.status();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const ok = status !== null && (ACCEPTED_STATUSES.has(status) || (status >= 200 && status < 400));
    if (ok) continue;

    const internal = /(^|\.)ryzesuperfoods\.com$/i.test(resolved.hostname);
    const ruleId = 'cross-page:broken-link';
    findings.push({
      id: `f-${runId}-${shortHash(ruleId + ':' + pageUrl + ':' + resolved.toString())}`,
      fingerprint: sha1(`${ruleId}:${pageUrl}:${resolved.toString()}`),
      runId,
      discoveredAt: new Date().toISOString(),
      ruleId,
      category: 'cross-page',
      source: 'cross-page',
      severity: internal ? 'high' : 'medium',
      url: pageUrl,
      relatedUrls: [resolved.toString()],
      element: { role: 'link', name: text, selector: `${containerSelector} a[href="${href}"]` },
      title: `Broken link in ${contextLabel}: ${resolved.toString()}`,
      description:
        `A link inside the "${contextLabel}" container on ${pageUrl} resolved to ` +
        `${resolved.toString()} which returned ${status === null ? 'no response' : `HTTP ${status}`}` +
        `${error ? ` (${error})` : ''}. Link text: "${text || '(no text)'}".`,
      remediation: 'Fix or remove the broken link, or correct the URL it points to.',
      confidence: 1.0,
      visualGate: {
        verdict: 'visible',
        reason: 'cross-page link check — no single element to gate',
        judgeModel: 'n/a',
      },
      meta: {
        context: contextLabel,
        httpStatus: status,
        lycheeError: error || null,
        isFragment: false,
        stub: true,
      },
    });
  }

  return findings;
}
