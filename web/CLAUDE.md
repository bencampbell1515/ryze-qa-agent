@AGENTS.md

# Ryze QA Agent — web dashboard

Static-export Next.js 16 app deployed to Firebase Hosting at **https://live-qa-agent.web.app**. Single-page, client-only (no SSR), authenticated against Firebase Auth with hard `@ryzewith.com` domain enforcement.

## Stack

| | Version / choice |
|---|---|
| Framework | Next.js 16.2 (App Router, **static export** via `output: 'export'`) |
| Styling | Tailwind 4 + CSS variables (no shadcn/ui — hand-rolled components) |
| Fonts | Instrument Serif (display), JetBrains Mono (data), Geist (body) |
| Data | Firebase JS SDK 12 — `firestore`, `auth`, `storage` |
| Build | Turbopack (Next 16 default) — output in `web/out/` |

## Routing — SPA via search params, not Next dynamic routes

Static export **cannot** use Next dynamic routes (`[id]`) without `generateStaticParams()`, which doesn't work for unbounded run IDs. So all in-app navigation is search-param based on a single page:

```
/?run=<runId>         → run detail
/?view=outputs        → outputs page
/?view=presets        → presets stub
/?view=diff           → diff view
/?view=stats          → stats stub
(no params)           → audits list (default)
```

`web/lib/view.ts` handles parse/push. `app/page.tsx` switches the rendered view in a single `<ViewRouter>` based on those params.

## Firestore schema (current)

| Collection | Doc shape (`web/lib/schema.ts`) |
|---|---|
| `runs/{id}` | `status`, `step`, `progress`, `requestedBy`, `requestedAt`, `startedAt?`, `completedAt?`, `bugCount?` (live during run, sums bugs.jsonl + discoveries.jsonl; pinned to scored count at completion), `urlCount?`, `urlsScanned?` (distinct-URL union across personas, capped at urlCount), `logTail?: string[]`, `reportPath?` (gs://), `pdfPath?`, `bugsJsonPath?`, `systemHealthPath?` (gs:// to system-health.md from `runMetaAnalysis()`), `scanConfig?`, `errorMessage?`. **Worktree N1 (2026-05-29) adds**: `findingsJsonPath?`, `uncertainFindingsJsonPath?`, `suppressedFindingsJsonPath?`, `hygieneJsonPath?`, `cropsPrefix?`, `findingsCount?`, `uncertainCount?`, `suppressedCount?`, `hygieneCount?`, `cropsCount?` — populated when the rebuild flags are on; undefined for legacy runs (FindingsSection hides itself in that case). |
| `runs/{id}/events/{eventId}` | `ts`, `level`, `message` — milestones + errors, NOT every log line |
| `diffRequests/{id}` | `runIdA`, `runIdB`, `status`, `exactOnlyA?`, `exactOnlyB?`, `exactBoth?`, `semanticPairs?` (Haiku output), `semanticSkipped?`, `errorMessage?` |

Doc ID for diffs is deterministic: `diffIdFor(a, b)` sorts and joins with `--`. Same pair → same doc → no recompute (see root CLAUDE.md gotcha).

Security rules (`firestore.rules` + `storage.rules` at repo root) — **see root CLAUDE.md "Security posture" for the full picture**:
- `isRyzeUser()` = signed-in + `email_verified` + `sign_in_provider == 'google.com'` + `@ryzewith.com` email.
- Create `runs`: `requested` status only, key allowlist, `requestedBy == auth.token.email`, `runId` regex, size caps on `note`/`scanConfig`.
- Update `runs`: only `cancel-requested`, and only by the original `requestedBy` (no insider griefing).
- Create `diffRequests`: `requested` status only, validates `runIdA`/`runIdB` shapes + pins `requestedBy`.
- Storage `/reports/{runId}/**` reads require `isRyzeUser()` + valid `runId`. All Storage writes are daemon-only via Admin SDK.
- App Check (reCAPTCHA v3) is initialized in `lib/firebase.ts` and wrapped in `try/catch`. Currently monitor-only; flip to enforce in the Firebase App Check console after a 24h soak.

## Themes — `data-theme` on `<html>`

Two full visual identities defined in `app/globals.css`:

- `instrument` (default): cold deep slate (`#08080c`), amber accent (`#ffb547`), dot-grid backdrop, hairline rules, JetBrains Mono everywhere, table-style runs list
- `atelier`: warm cream paper (`#f4ede0`), terracotta accent (`#b8431a`), light dot-grid, magazine-style run **cards** (`components/RunCards.tsx`)

`lib/theme.tsx` exposes `useTheme()` + `<ThemeProvider>` — flips the `data-theme` attribute and persists to `localStorage` under `ryze-qa-theme`. Components conditionally render different layouts when meaningful (e.g. `RunList.tsx` swaps `<RunTable>` ↔ `<RunCards>` based on theme).

All colors are CSS custom properties — never hard-code `text-zinc-X`. Use `text-[var(--color-ink-1)]` etc. so both themes get the swap for free.

## Components inventory

| File | What it does |
|---|---|
| `components/Header.tsx` | Top rail. Pulsing diode + brand mark + theme toggle + sign-out. Renders a scanline animation under the rail when any run is active. |
| `components/SideNav.tsx` | 72px icon rail on the left (desktop only). Hand-drawn line icons, amber bar on active item. |
| `components/SignInScreen.tsx` | Centered editorial card with corner registration marks. `@ryzewith.com` domain enforced in `lib/auth.tsx`. |
| `components/RunList.tsx` | Dashboard home. "Audits." headline, ARM-style INITIATE button, telemetry strip, runs table (instrument) or cards (atelier). |
| `components/RunCards.tsx` | Atelier-only run list — magazine cards with colored status band, giant serif bug count. |
| `components/RunDetail.tsx` | Per-run page. 120–160px editorial italic headline whose color encodes status. 4-cell telemetry grid (Progress · URLs scanned/discovered · Bugs · Elapsed) — URL stat shows `X of Y discovered`, Elapsed ticks every second via `useEffect(setInterval, 1000)` while status is running/requested. Cancel button when active. View HTML / Download PDF / System health buttons when complete (System health appears only if `run.systemHealthPath` is set). |
| `components/LogStream.tsx` | Terminal-style log panel. Color-coded by line source: persona = amber, playwright = lavender, errors = coral, successes = teal. Auto-scrolls unless the user manually scrolls up. |
| `components/Diode.tsx` | Status indicator light. Pulses for active states. CSS classes `diode--amber/teal/coral/lav`. |
| `components/Numeral.tsx` | Editorial italic display number (Instrument Serif). The signature "big number" moment — use sparingly. |
| `components/OutputsPage.tsx` | Lists artifacts in `reports/{runId}/` from Firebase Storage, grouped by run, with file-type badges. |
| `components/DiffView.tsx` | Two-pass diff: writes a `diffRequests` doc, subscribes for results. Renders progressive states (`running-exact` → `running-semantic` → `complete`). Semantic matches get a dedicated section with confidence bars + per-pair reason. |
| `components/ScanConfigModal.tsx` | Slide-in panel from the right. Sections: site scope, check categories (collapsible per-rule), personas, viewports, max URLs, URL exclude chips, presets stub. Captures intent into `scanConfig` field on the run doc — backend wire-up is partial (see root CLAUDE.md). |
| `components/PlaceholderPage.tsx` | Editorial "coming soon" page used by Presets + Stats. Big serif title + roadmap checklist. |
| `components/FindingsSection.tsx` | **Worktree N2 (2026-05-29).** Tabbed Findings section rendered inside `RunDetail` after the live log. Four tabs (Main / Needs review / Suppressed / Hygiene) with lazy per-tab fetch from `findings.jsonl` / `uncertain-findings.jsonl` / `suppressed-findings.jsonl` / `hygiene.jsonl`. Hides itself entirely when the run doc has no `findingsJsonPath` (legacy runs). |
| `components/FindingCard.tsx` | **Worktree N2.** Single finding card: severity + confidence badges (`--color-sev-*` / `--color-conf-*` tokens added in `globals.css`), inline lazy crop (480px, object-fit:contain) via `useCropUrl`, expandable two-judge `visualGate` reasoning, expandable per-dimension `rubricVerdicts`, ruleId/source badges, expandable description/remediation. |
| `components/FindingsList.tsx` | **Worktree N2.** Filterable list — severity / category / source multi-select, local state, no Firestore. |
| `components/HygieneEntry.tsx` | **Worktree N2.** Compact reference row for hygiene exclusions (URL + scope-filter rule that matched). |

## Conventions

- **Short ID format:** `SC-${id.slice(0, 6).toUpperCase()}` — used everywhere a Firestore doc ID is shown to humans. Helper duplicated in a few components; keep them consistent.
- **Section labels:** small mono `§ NN · TITLE` with hairline rule on both sides. Use for visual rhythm.
- **Status colors:** amber = running/queued (live), teal = complete (cool), coral = failed (warm error), lavender = cancelled/halting (muted).
- **Animations:** `rise-in` + `rise-delay-1..4` on first mount for staggered reveals. Don't sprinkle micro-animations everywhere — concentrate them on page entry.

## Tests

Unit tests run on **vitest** (added in worktree N2 — the dashboard had no test runner before).

```bash
cd web
npm test          # vitest run (CI mode, one-shot)
npm run test:watch
```

Config in `vitest.config.ts` (node environment, `@/*` alias mirrored from tsconfig, picks up `lib/**/*.test.ts`). Scope is deliberately the **pure helpers** — JSONL parsing and crop-path resolution in `lib/findings-parse.ts` — plus fixture round-trip tests (`lib/__fixtures__/*.jsonl`) that pin the canonical Finding/HygieneFinding shape the daemon uploads. React/Firebase hooks are not unit-tested (no precedent, would need DOM + SDK mocks); the live dry-run against an N1-produced run is the integration test.

> **Lint note:** `eslint-config-next` 16 enforces `react-hooks/set-state-in-effect`, which the pre-existing hooks (`lib/theme.tsx`, `lib/diff.ts`, `app/page.tsx`, `components/DiffView.tsx`, `components/ScanConfigModal.tsx`, and the original `useRun`/`useRunEvents` in `lib/runs.ts`) all violate — so `npm run lint` reports 7 errors on `main` today. The N2 components add none. `next build` does not gate on lint, so the deploy pipeline is unaffected.

## Deploy

```bash
# from repo root
firebase deploy --only hosting                  # UI only
firebase deploy --only hosting,firestore:rules  # rules + UI
firebase deploy --only firestore:rules,storage  # rules only
```

The `firebase.json` `predeploy` script runs `cd web && npm run build` automatically. Build output is `web/out/` (gitignored).

## Critical gotcha for editors

This Next.js is **16**, not 14 or 15. Async request APIs (cookies/params/searchParams), middleware → proxy, and `next/image` defaults all changed. Check `node_modules/next/dist/docs/` before assuming the API. The `AGENTS.md` import at the top of this file pins that reminder.
