# Operational Constraint: Cloudflare O2O Egress

This site is fronted by **Cloudflare Orange-to-Orange (O2O)**, which gates bot
traffic at the TLS layer. The constraint is environmental, not application,
and shapes how every HTTP-touching check must be written. Discovered
operationally during the worktree B (lychee) dry-run; recording it here so
the next worktree author doesn't have to rediscover it.

## What O2O is

Cloudflare classifies inbound clients by TLS fingerprint (JA3/JA4 +
ALPN + cipher order + extensions) before any HTTP headers are parsed.
"Trusted" clients — real browsers, including a locally-installed Chrome
launched via Playwright's `channel: 'chrome'` — pass straight through.
Anything else (Node `fetch`, `curl`, Go/Rust HTTP clients, headless
Chromium with the wrong build, scrapers) gets a **403 Forbidden** at the
edge, regardless of User-Agent header. A spoofed UA doesn't help: the
fingerprint is set before the header is sent.

The site's `robots.txt` reinforces this — it disallows agentic flows —
but the load-bearing enforcement is the TLS gate, not robots.

## Why lychee got 403'd (worktree B dry-run, 2026-05-29)

lychee 0.24.2 uses `reqwest` (Rust's `hyper` + `rustls`) as its HTTP
client. Its fingerprint isn't on Cloudflare's trust list. Concrete result
from a 50-URL pass against `www.ryzesuperfoods.com`:

- Direct lychee → live URLs: **whole run aborts** with `403 Forbidden`,
  even at `--max-concurrency 2`.
- Workaround (pre-fetch pages through a different path, then point
  lychee at the local HTML): **12 of 50** pages were fetchable, **38**
  returned 403.
- All 26 "broken links" lychee then reported were HTTP 403, zero 404s —
  bot-blocks, not real breakage. Same UA / same paths returned 200 when
  hit via system Chrome on the O2O-trusted path.

The check itself is correct. The signal is unreadable from this egress.

## How the production audit avoids it

The audit uses `@playwright/test` configured with `channel: 'chrome'`,
which launches the **locally-installed system Chrome** — same fingerprint
Cloudflare already trusts. Switching to `chromium` (Playwright's bundled
build) or to `headless` mode does NOT change the noise level; what
matters is the Chrome binary, not the head/headless flag.

Sitemap fetches that don't go through Playwright use `execFile('curl', ...)`
shelled out to system `curl`, with `--proto =https,http --proto-redir =https`
hardening. System `curl` happens to have a fingerprint Cloudflare lets
through for this surface; Node's built-in `fetch` does not.

## Implication for future worktrees

**Any check that needs direct HTTP access to `ryzesuperfoods.com` or
`shop.ryzesuperfoods.com` must flow through the Playwright fetch path
or `page.goto()` against a Playwright-managed Chrome context.**

- ✅ `page.goto(url)`, `page.request.fetch(url)`, `browserContext.request`
  — all go through the trusted Chrome process.
- ✅ `execFile('curl', ...)` for sitemap-style fetches — empirically works.
- ❌ Node `fetch`, `node-fetch`, `axios`, `got`, `undici`, raw `http(s)`
  module — TLS fingerprint mismatch, will 403.
- ❌ Bundled binaries that do their own HTTP (lychee, wget, httpie, link
  checkers written in Go/Rust) — same problem. lychee specifically still
  works when pointed at **local HTML files**, with link extraction +
  fragment validation done over the file. Live URL fetching is what
  breaks.

A check that fundamentally needs to bypass Chrome (e.g., raw certificate
inspection, custom protocol probe) should route its requests through
`page.request` against an open page on the target origin so the call
inherits the trusted context.

## Implication for Cloud Run migration

The daemon currently runs on a Mac whose Chrome is on the O2O trust list.
Cloud Run egress IPs are not. A direct port without changes would
reproduce the lychee scenario site-wide: the audit would 403 against
every URL.

Two paths work; the third does not:

1. **Run system Chrome on Cloud Run (or any container with a real Chrome
   build) and let Playwright drive it.** This is what already works locally,
   transposed. Container needs Chrome installed (`google-chrome-stable`
   or equivalent), not Playwright's bundled Chromium. Resource cost is
   higher than a pure-Node container.
2. **Register the Cloud Run egress IP range with Cloudflare as O2O-trusted
   (or as an allowlisted bypass rule).** Coordinate with Felipe — same
   process used for the existing O2O setup. Lets HTTP clients of any kind
   pass through. Operationally cleaner; depends on whether RYZE's
   Cloudflare plan supports static egress allowlisting.
3. ❌ **Spoof the Chrome TLS fingerprint from Node/Rust.** Tools like
   `curl-impersonate` exist, but Cloudflare actively rotates detection.
   Brittle, opaque when it breaks, and not worth maintaining when
   options 1 and 2 are stable.

If migration ships before either is in place, the audit will run but
produce 100% bot-noise findings — same signature as the lychee dry-run:
a wall of `network:403` and `network:failed` that don't correspond to
any user-visible defect.

## See also

- `CLAUDE.md` → "Key gotchas" → Cloudflare O2O, Node fetch, system sleep,
  `network:failed` vs `network:404` distinctions.
- `src/crawl/sitemap.ts` — the `curl`-via-`execFile` pattern in
  `curlFetch()`, with `assertAllowedHost()` enforcing the allowlist.
- PR #7 (worktree B) — comment of 2026-05-29 has the raw dry-run data
  and per-URL 403/200 split.
