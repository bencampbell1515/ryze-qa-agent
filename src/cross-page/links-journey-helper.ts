/**
 * Worktree B — journey-facing link helper.
 *
 * worktree E (journey tests) imports this to validate the links that live
 * inside a specific DOM container in a specific flow context — e.g. the
 * privacy-policy link inside the checkout disclaimer, which 404s only in that
 * context and is invisible to a static crawl.
 *
 * Flow: extract the <a href> values inside `containerSelector`, dedupe, run
 * them through lychee via {@link checkLinks}, then rewrite each Finding so it
 * is anchored to the *real* page (not the throwaway temp file lychee scanned)
 * and tagged with the flow `contextLabel`.
 */
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import type { Finding } from '../types/finding.js';
import { checkLinks, type LycheeExecutor } from './links.js';

/** The slice of the Playwright Page API this helper needs. */
export interface PageLike {
  /** Returns the current page URL. */
  url(): string;
  /** Runs a function against all elements matching `selector`, in-page. */
  $$eval<R>(
    selector: string,
    pageFunction: (els: Element[]) => R,
  ): Promise<R>;
}

/** RYZE first-party hosts, used as the internal-domain fallback. */
const RYZE_HOSTS = [
  'www.ryzesuperfoods.com',
  'shop.ryzesuperfoods.com',
  'ryzesuperfoods.com',
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Extract, dedupe, and lychee-check every link inside a container, returning
 * Findings anchored to the live page and tagged with `contextLabel`.
 *
 * @param page              Playwright Page (or compatible {@link PageLike})
 * @param containerSelector CSS selector for the container to scope links to
 * @param runId             run these findings belong to
 * @param contextLabel      flow context, e.g. "checkout-disclaimer" → meta.context
 * @param exec              injectable lychee runner (defaults to the real binary)
 */
export async function checkLinksInContainer(
  page: Page | PageLike,
  containerSelector: string,
  runId: string,
  contextLabel: string,
  exec?: LycheeExecutor,
): Promise<Finding[]> {
  const p = page as PageLike;

  const hrefs = await p.$$eval(`${containerSelector} a[href]`, (els) =>
    els
      .map((el) => (el as HTMLAnchorElement).href)
      .filter((href) => typeof href === 'string' && href.length > 0),
  );

  // Dedupe, drop empties and javascript:/mailto: style non-navigations.
  const unique = Array.from(new Set(hrefs)).filter(
    (h) => h && !/^(javascript|mailto|tel):/i.test(h),
  );
  if (unique.length === 0) return [];

  const pageUrl = safeUrl(page);
  const pageHost = pageUrl ? hostOf(pageUrl) : null;
  const internalDomains = pageHost ? [pageHost] : RYZE_HOSTS;

  // Write a throwaway HTML doc containing just these links. lychee scans the
  // file; we re-anchor the findings to the real page afterward so fingerprints
  // stay stable (a random temp filename would otherwise churn every run).
  const tmpFile = join(tmpdir(), `ryze-links-${randomUUID()}.html`);
  const body = unique
    .map((h) => `  <a href="${escapeHtml(h)}">${escapeHtml(h)}</a>`)
    .join('\n');
  const html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>\n${body}\n</body></html>\n`;

  try {
    await writeFile(tmpFile, html, 'utf8');

    const { findings } = await checkLinks(
      {
        inputs: [tmpFile],
        internalDomains,
        // Fragment checks against a synthetic file are meaningless — the
        // target pages aren't in the input set. Stick to HTTP reachability.
        includeFragments: false,
        // Ephemeral context: keep the cache out of the repo working tree.
        cacheDir: join(tmpdir(), 'ryze-lychee-cache'),
      },
      runId,
      exec,
    );

    return findings.map((finding) => {
      const brokenUrl = finding.relatedUrls?.[0] ?? finding.url;
      const source = pageUrl ?? finding.url;
      // Re-anchor to the live page and recompute the fingerprint off the real
      // source so it is stable across runs (temp filename is not).
      const fingerprint = createHash('sha1')
        .update(`${finding.ruleId}:${source}:${brokenUrl}`)
        .digest('hex');
      return {
        ...finding,
        fingerprint,
        id: `f-${runId}-${fingerprint.slice(0, 8)}`,
        url: source,
        relatedUrls: [brokenUrl],
        description:
          `${finding.description} (Found in flow context "${contextLabel}" ` +
          `on ${source}.)`,
        meta: { ...finding.meta, context: contextLabel },
      };
    });
  } finally {
    await rm(tmpFile, { force: true });
  }
}

function safeUrl(page: Page | PageLike): string | null {
  try {
    const u = (page as PageLike).url();
    return typeof u === 'string' && u ? u : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
