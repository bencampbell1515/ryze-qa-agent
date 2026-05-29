/**
 * Worktree B — Link integrity via lychee.
 *
 * Wraps the lychee link checker (Rust CLI) as a cross-page check. lychee is
 * fast, async, supports anchor-fragment verification, JSON output, and
 * caching out of the box, which closes three gaps the page-level network
 * check misses:
 *   - contextual links that 404 only inside a flow (worktree E feeds those in)
 *   - broken anchor fragments (#section) that never return an HTTP error
 *   - site-wide broken outbound/internal links the network check doesn't
 *     aggregate
 *
 * lychee is NOT bundled. It must be on PATH or pointed at via LYCHEE_BIN /
 * config.binPath. See the README "Link integrity (lychee)" section for install.
 *
 * Verified against lychee 0.24.2. Failures land in `error_map` (older
 * versions used `fail_map`; the parser reads both). Status objects carry
 * `{ text, details, code? }`; broken fragments report `text: "Cannot find
 * fragment"` with no code.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Finding } from '../types/finding.js';

const execFileAsync = promisify(execFile);

export interface LinkCheckConfig {
  /** Path to the lychee binary. Defaults to "lychee" on PATH. */
  binPath?: string;
  /** URLs or HTML files to check. */
  inputs: string[];
  /** Domain allow-list. Links to other domains are checked but won't
   *  produce critical findings (they may break, but we don't own them). */
  internalDomains: string[];
  /** Whether to include anchor fragment verification. Default true. */
  includeFragments?: boolean;
  /** Patterns to exclude from checking. Same as lychee --exclude. */
  excludePatterns?: string[];
  /** Concurrency. Default 16. */
  concurrency?: number;
  /** Cache directory. Default ".lycheecache". */
  cacheDir?: string;
}

export interface LinkCheckResult {
  /** All broken links found. */
  broken: BrokenLink[];
  /** Findings ready to emit into the run. */
  findings: Finding[];
  /** Raw lychee JSON output for debugging. */
  rawOutput: unknown;
}

export interface BrokenLink {
  url: string;
  /** Where this link was found (page URL or HTML file path). */
  source: string;
  /** HTTP status code or null if it never resolved. */
  status: number | null;
  /** Error message from lychee. */
  error: string;
  /** True if this is a broken anchor fragment, not an HTTP error. */
  isFragment: boolean;
}

/**
 * Result of one subprocess invocation. The executor never throws on a
 * non-zero exit (lychee exits non-zero when it finds broken links — that is
 * the expected success path here). It only throws on spawn failures (ENOENT).
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Injectable subprocess runner. Production code uses {@link defaultExecutor};
 * unit tests pass a stub so lychee never has to be installed in CI.
 */
export type LycheeExecutor = (
  binPath: string,
  args: string[],
  opts: { cwd?: string },
) => Promise<ExecResult>;

const ACCEPT_RANGES = '200..=299,301,302,304,307,308';
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_CACHE_DIR = '.lycheecache';

/** Real subprocess executor backed by node:child_process.execFile. */
export const defaultExecutor: LycheeExecutor = async (binPath, args, opts) => {
  try {
    const { stdout, stderr } = await execFileAsync(binPath, args, {
      cwd: opts.cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
    };
    // Spawn failure (binary not found / not executable): rethrow so callers
    // can surface a clear install message.
    if (e.code === 'ENOENT' || e.code === 'EACCES') throw err;
    // Non-zero exit code: lychee found broken links. stdout still holds the
    // JSON report, so resolve normally and let the parser handle it.
    if (typeof e.code === 'number') {
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code };
    }
    throw err;
  }
};

/**
 * Confirm lychee is invokable before doing real work. Throws a clear,
 * actionable error at startup if the binary is missing.
 */
export async function verifyLycheeInstalled(
  binPath: string,
  exec: LycheeExecutor,
): Promise<void> {
  try {
    await exec(binPath, ['--version'], {});
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT' || e.code === 'EACCES') {
      throw new Error(
        `lychee binary not found (tried "${binPath}"). Install it ` +
          `(brew install lychee, or download from ` +
          `https://github.com/lycheeverse/lychee/releases) and ensure it is ` +
          `on PATH, or set LYCHEE_BIN / config.binPath. lychee is required ` +
          `and is never auto-installed.`,
      );
    }
    throw err;
  }
}

/** Treat a string as a URL input (vs a local file/glob path) when it has a scheme. */
function isUrlInput(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
}

/** Suffix-match a hostname against the internal-domain allow-list. */
function isInternalHost(host: string, internalDomains: string[]): boolean {
  const h = host.toLowerCase();
  return internalDomains.some((d) => {
    const dom = d.toLowerCase().replace(/^\*\./, '');
    return h === dom || h.endsWith('.' + dom);
  });
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Pull a numeric HTTP status code out of lychee's polymorphic `status` field. */
function extractStatusCode(status: unknown): number | null {
  if (status == null) return null;
  if (typeof status === 'number') return status;
  if (typeof status === 'object') {
    const s = status as Record<string, unknown>;
    if (typeof s.code === 'number') return s.code;
    if (typeof s.status === 'number') return s.status;
  }
  return null;
}

/** Pull a human-readable error/status string out of lychee's `status` field. */
function extractStatusText(status: unknown): string {
  if (status == null) return '';
  if (typeof status === 'string') return status;
  if (typeof status === 'object') {
    const s = status as Record<string, unknown>;
    for (const key of ['text', 'details', 'message', 'type']) {
      if (typeof s[key] === 'string' && s[key]) return s[key] as string;
    }
    return JSON.stringify(s);
  }
  return String(status);
}

/**
 * Classify a failing link as a broken anchor fragment rather than a broken
 * URL. A fragment failure is one where the resource itself resolves (2xx) but
 * the `#fragment` target is absent, OR where lychee's message explicitly names
 * a fragment/anchor problem. A hard HTTP failure (4xx/5xx) or an unreachable
 * host on a fragment URL is a broken *link*, not a broken fragment.
 */
function classifyFragment(url: string, code: number | null, text: string): boolean {
  const hashIdx = url.indexOf('#');
  const hasFragment = hashIdx >= 0 && url.length > hashIdx + 1;
  if (!hasFragment) return false;
  const codeOk = code != null && code >= 200 && code < 400;
  const textMentionsFragment = /fragment|anchor/i.test(text);
  return codeOk || textMentionsFragment;
}

interface ParsedFailure {
  source: string;
  url: string;
  code: number | null;
  text: string;
}

/** Walk lychee's `fail_map` (and legacy `error_map`) into a flat failure list. */
function collectFailures(raw: Record<string, unknown>): ParsedFailure[] {
  const out: ParsedFailure[] = [];
  for (const mapKey of ['fail_map', 'error_map']) {
    const map = raw[mapKey];
    if (!map || typeof map !== 'object') continue;
    for (const [source, entries] of Object.entries(map as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (typeof entry === 'string') {
          out.push({ source, url: entry, code: null, text: '' });
          continue;
        }
        if (entry && typeof entry === 'object') {
          const e = entry as Record<string, unknown>;
          const url = typeof e.url === 'string' ? e.url : '';
          if (!url) continue;
          out.push({
            source,
            url,
            code: extractStatusCode(e.status),
            text: extractStatusText(e.status),
          });
        }
      }
    }
  }
  return out;
}

/**
 * Build args for the lychee invocation. Exposed for testing and debugging.
 * File inputs are resolved to absolute paths because we run lychee with its
 * working directory set to the cache dir (so `.lycheecache` lands there);
 * URL inputs are passed through untouched.
 */
export function buildLycheeArgs(config: LinkCheckConfig): string[] {
  const args = [
    '--format',
    'json',
    '--no-progress',
    '--accept',
    ACCEPT_RANGES,
    '--cache',
    '--max-cache-age',
    '1d',
    '--max-concurrency',
    String(config.concurrency ?? DEFAULT_CONCURRENCY),
  ];
  if (config.includeFragments ?? true) {
    args.push('--include-fragments');
  }
  for (const pattern of config.excludePatterns ?? []) {
    args.push('--exclude', pattern);
  }
  for (const input of config.inputs) {
    args.push(isUrlInput(input) ? input : resolve(input));
  }
  return args;
}

/**
 * Run lychee over the configured inputs and translate broken links into
 * Findings. Deterministic check — no LLM in the hot path (per the cost
 * discipline in docs/check-author-guide.md).
 *
 * @param config  inputs, domain classification, and lychee knobs
 * @param runId   the run these findings belong to
 * @param exec    injectable subprocess runner (defaults to the real binary);
 *                tests pass a stub so lychee need not be installed
 */
export async function checkLinks(
  config: LinkCheckConfig,
  runId: string,
  exec: LycheeExecutor = defaultExecutor,
): Promise<LinkCheckResult> {
  const binPath = config.binPath || process.env.LYCHEE_BIN || 'lychee';

  // Fail fast and clearly if lychee is missing.
  await verifyLycheeInstalled(binPath, exec);

  const cacheDir = config.cacheDir || DEFAULT_CACHE_DIR;
  await mkdir(cacheDir, { recursive: true });

  const args = buildLycheeArgs(config);
  const { stdout, stderr } = await exec(binPath, args, { cwd: cacheDir });

  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error(
      `lychee did not return valid JSON. ` +
        `stdout:\n${stdout}\n---\nstderr:\n${stderr}`,
    );
  }

  const failures = collectFailures(raw as Record<string, unknown>);

  const broken: BrokenLink[] = [];
  const findings: Finding[] = [];
  const discoveredAt = new Date().toISOString();

  for (const f of failures) {
    const isFragment = classifyFragment(f.url, f.code, f.text);
    broken.push({
      url: f.url,
      source: f.source,
      status: f.code,
      error: f.text,
      isFragment,
    });

    const host = hostOf(f.url);
    const internal = host ? isInternalHost(host, config.internalDomains) : false;

    const ruleId = isFragment ? 'cross-page:broken-fragment' : 'cross-page:broken-link';
    // Fragments are always medium; otherwise internal=high, external=medium.
    const severity: Finding['severity'] = isFragment ? 'medium' : internal ? 'high' : 'medium';

    // Stable across runs: ruleId + source page + broken URL. For broken-link
    // this matches the brief's sha1('cross-page:broken-link:' + src + ':' + url).
    const fingerprint = createHash('sha1')
      .update(`${ruleId}:${f.source}:${f.url}`)
      .digest('hex');

    const statusLabel = f.code != null ? `HTTP ${f.code}` : f.text || 'no response';
    const title = isFragment ? `Broken anchor fragment: ${f.url}` : `Broken link: ${f.url}`;
    const scope = internal ? 'internal' : 'external';
    const description = isFragment
      ? `Anchor fragment "${f.url}" found on ${f.source} does not resolve to an ` +
        `element on the target page (${statusLabel}). Fragment links fail ` +
        `silently — the browser shows no error, the user just lands in the ` +
        `wrong place.`
      : `Broken ${scope} link "${f.url}" found on ${f.source} (${statusLabel}). ` +
        `${internal ? 'First-party' : 'Third-party'} link returned a failing status.`;

    findings.push({
      id: `f-${runId}-${fingerprint.slice(0, 8)}`,
      fingerprint,
      runId,
      discoveredAt,
      ruleId,
      category: 'cross-page',
      source: 'cross-page',
      severity,
      url: f.source,
      relatedUrls: [f.url],
      title,
      description,
      confidence: 1.0,
      visualGate: {
        verdict: 'visible',
        reason: 'cross-page check, no element',
        judgeModel: 'n/a',
      },
      meta: {
        httpStatus: f.code,
        lycheeError: f.text,
        isFragment,
      },
    });
  }

  return { broken, findings, rawOutput: raw };
}
