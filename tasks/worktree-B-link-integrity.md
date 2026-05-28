# Worktree B: Link Integrity with lychee

## Mission

Wrap the lychee link checker (Rust CLI, fast, open source) as a cross-page
check that finds broken links across the full crawl, including anchor
fragments. Expose a programmatic `checkLinks(urls)` API that worktree E
(journey tests) can use to validate links extracted from journey-specific
DOM snapshots.

## Why

Audit misses surfaced these classes:
- The privacy-policy link inside checkout that 404s in context (worktree E
  catches the contextual variant; this worktree provides the link-checking
  primitive E uses).
- Broken anchor fragments (`#section`) that never return an HTTP error and
  are invisible to ordinary network checks.
- Site-wide broken outbound and internal links that the current network
  check doesn't aggregate.

lychee handles all three out of the box, with anchor-fragment support, async
performance, JSON output, and caching.

## Files to create

### `src/cross-page/links.ts`

```typescript
import type { Finding } from '../types/finding';

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

export async function checkLinks(
  config: LinkCheckConfig,
  runId: string
): Promise<LinkCheckResult>;
```

Behavior:
- Shell out to lychee with `--format json --no-progress`.
- Set `--accept 200..=299,301,302,304,307,308` so redirects don't count as
  broken.
- If `includeFragments`, add `--include-fragments`.
- Apply `excludePatterns` via repeated `--exclude` flags.
- Use the configured cache directory for `.lycheecache`. Pass `--cache`
  and `--max-cache-age 1d`.
- Parse the JSON output. For every link with status >= 400 or error, emit:
  - A `BrokenLink` in `result.broken`
  - A `Finding` with:
    - `ruleId: 'cross-page:broken-link'` (or `cross-page:broken-fragment`
      for anchor-only failures)
    - `category: 'cross-page'`
    - `source: 'cross-page'`
    - `severity: 'high'` for internal-domain broken links; `'medium'` for
      external; `'medium'` for broken fragments
    - `url: <source page>`, `relatedUrls: [<broken link>]`
    - `title: 'Broken link: <url>'`
    - `description: <human-readable, what page, where it was found, what status>`
    - `fingerprint: sha1('cross-page:broken-link:' + sourcePage + ':' + brokenUrl)`
    - `confidence: 1.0` (deterministic check)
    - `visualGate: { verdict: 'visible', reason: 'cross-page check, no element', judgeModel: 'n/a' }`
    - `meta: { httpStatus, lycheeError, isFragment }`

## Files to also create

### `src/cross-page/links-journey-helper.ts`

A small helper worktree E will import. Given a Playwright Page and a CSS
selector for a container, extract all links inside that container, run them
through lychee, return Findings.

```typescript
import type { Page } from 'playwright';
import type { Finding } from '../types/finding';

export async function checkLinksInContainer(
  page: Page,
  containerSelector: string,
  runId: string,
  contextLabel: string  // e.g. "checkout-disclaimer", goes into meta
): Promise<Finding[]>;
```

This is how the contextual privacy-policy link gets caught: worktree E
calls this against the checkout disclaimer container; the URLs extracted in
that context get checked.

Implementation: extract `href` values from `a` tags inside the container,
deduplicate, write a small temp HTML file with just those links (or pass
them via stdin to lychee), invoke `checkLinks`, attach `contextLabel` to
each finding's `meta.context`.

## Tests

`tests/cross-page/links.test.ts`:
- positive: a fixture HTML file with one 404 link produces one Finding
- positive: a working link produces zero Findings
- positive: a broken anchor fragment produces a Finding with
  `ruleId: 'cross-page:broken-fragment'`
- edge: lychee binary not on PATH → throws a clear error at startup
- edge: lychee returns non-JSON → throws with the raw output in the error
- internal vs external classification: same fixture, different
  `internalDomains` config, severities flip

`tests/cross-page/links-journey-helper.test.ts`:
- given a mock Page with a container containing 3 links (2 ok, 1 broken),
  return 1 Finding with `meta.context` set to the label

Mock lychee in unit tests by stubbing the child_process call. There's no
need to actually install lychee in CI for unit tests; have a separate
`npm run test:integration` if you want a live-lychee test.

## Success criteria

- `npm run test:unit` passes.
- A dry-run against `ryzesuperfoods.com` finds at least the known broken
  links from the bug report PDF (broken privacy-policy link if reachable
  via static crawl; broken image links on recipe pages produce
  `cross-page:broken-link` findings).
- `checkLinksInContainer` is import-able and documented; worktree E will
  consume it.
- No changes outside `src/cross-page/`, `tests/cross-page/`,
  `.env.example` (only for `LYCHEE_BIN` if missing).

## Reference

- lychee docs: https://lychee.cli.rs/overview/
- lychee --include-fragments: https://lychee.cli.rs/usage/cli/
- `src/types/finding.ts` — Finding shape
- `docs/check-author-guide.md` — conventions, especially fingerprint formula

## Boundaries — do not

- Modify check modules under `src/checks/`
- Modify orchestrate
- Bundle lychee into the repo. Require it on PATH or via `LYCHEE_BIN`.
  Document install in README addition.
- Auto-install lychee. If it's missing, error clearly.

## PR convention

Title: `worktree-B: lychee link integrity`

Description must list:
- Files added
- Tests added
- lychee version used (pin in docs)
- Dry-run finding count and sample (paste 2-3 findings)
- Install instructions added to README (a short section explaining
  `brew install lychee` or download from releases)

## Open assumptions to verify

1. The orchestrator collects findings from `src/cross-page/index.ts` style
   manifest. If not, create the manifest and document.
2. Whether to install lychee inside the Docker image (yes, eventually,
   for Cloud Run; out of scope for this worktree, document for worktree F
   or a later DevOps task).
