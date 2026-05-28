# Preflight: Commit to main before fanning out worktrees

These changes go on `main` in a single PR before you create any feature
worktree. They establish the shared contracts every parallel session imports.

If you skip the preflight, parallel sessions will produce mutually
incompatible output and integration will be a multi-day mess.

## Files to add on main

```
src/types/finding.ts                # Canonical Finding + HygieneFinding + CanonicalRecord
docs/check-author-guide.md          # Conventions every check follows
config/canonical-record.json        # Single source of truth for cross-page assertions
config/scope-filter.json            # Deny-list patterns for crawl scope
tasks/00-preflight.md               # this file
tasks/worktree-A-crawl-scope.md
tasks/worktree-B-link-integrity.md
tasks/worktree-C-language-detection.md
tasks/worktree-D-content-rules.md
tasks/worktree-E-journey-tests.md
tasks/worktree-F-visual-regression.md
tasks/worktree-G-entity-consistency.md
```

## Files to modify on main

### `CLAUDE.md`

Add at the top, before the existing content:

> ## For worktree sessions
>
> If you are running in a worktree and the task is "build worktree X", your
> first step is to read `tasks/worktree-X-*.md` for the specific spec, then
> `src/types/finding.ts` for the shared interface, then
> `docs/check-author-guide.md` for conventions. Only then read the rest of
> this file.
>
> The worktree brief is authoritative. If something in this file or
> `README.md` conflicts with the brief, the brief wins. Surface the conflict
> on the PR.

### `.env.example`

Add the new env vars all worktrees may reference:

```
# Shopify Admin API (worktree A)
SHOPIFY_SHOP_DOMAIN=
SHOPIFY_ADMIN_TOKEN=

# lychee binary path (worktree B). Defaults to "lychee" on PATH.
LYCHEE_BIN=lychee

# fastText / language detection (worktree C). Optional; default is in-process eld.
FASTTEXT_MODEL_PATH=

# Visual regression baseline storage (worktree F). Local path for MVP;
# GCS bucket for production.
VISUAL_BASELINE_DIR=./baselines
VISUAL_BASELINE_GCS_BUCKET=
```

### `config/canonical-record.json`

Seed values; product team will refine:

```json
{
  "businessAddresses": [
    "REPLACE WITH ACTUAL RYZE BUSINESS ADDRESS"
  ],
  "supportEmail": "hello@ryzesuperfoods.com",
  "brandName": "RYZE",
  "brandVariants": ["RYZE", "Ryze"],
  "acceptableCopyrightYears": [2025, 2026],
  "localePathPrefixes": {
    "es": "/es/",
    "fr": "/fr/"
  },
  "brandTerms": [
    "brandambassador",
    "ambassador",
    "mushroom coffee",
    "mushroom matcha",
    "mushroom hot cocoa",
    "RYZE",
    "RYZErs",
    "ritual set"
  ]
}
```

The address list needs to be the real business address before worktree G
runs. The brand-variant entry "Ryze" is included on purpose so worktree G
flags inconsistent casing; remove it if you want mixed-case to be acceptable.

### `config/scope-filter.json`

```json
{
  "denyPatterns": [
    "/products/copy-of-",
    "/luka/cro-tests/",
    "/bridge/",
    "/debug/",
    "/admin/",
    "/account/login",
    "/account/register",
    "/cart/mc-ca",
    "/cart/mc01-dynamic"
  ],
  "allowOverrides": []
}
```

The cart-specific entries reflect the audit PDF that showed ad-traffic carts
landing on test endpoints. If a real cart URL pattern emerges, move it out
of deny and let it audit.

## Workflow

```bash
# On main
git checkout main
git pull

# Add and modify files above, all in one commit
git add src/types/finding.ts docs/check-author-guide.md config/*.json tasks/*.md
git add CLAUDE.md .env.example
git commit -m "preflight: shared contracts for worktree fan-out"
git push

# Create the worktrees
git worktree add ../ryze-qa-agent-A feature/worktree-A
git worktree add ../ryze-qa-agent-B feature/worktree-B
git worktree add ../ryze-qa-agent-C feature/worktree-C
git worktree add ../ryze-qa-agent-D feature/worktree-D
git worktree add ../ryze-qa-agent-E feature/worktree-E
git worktree add ../ryze-qa-agent-F feature/worktree-F
git worktree add ../ryze-qa-agent-G feature/worktree-G

# In each one
cd ../ryze-qa-agent-A
cp ../ryze-qa-agent/.env .env   # or symlink
code .                          # opens VS Code in this worktree
# Start Claude Code, prompt below
```

## Kickoff prompt for each worktree

Replace `X` with the letter:

> You are doing worktree X. Read `tasks/worktree-X-*.md`, then
> `src/types/finding.ts`, then `docs/check-author-guide.md`. Then read
> `CLAUDE.md` and `README.md` for repo context. Build the worktree per the
> brief. Do not modify any file outside the paths the brief lists. Commit
> frequently with descriptive messages. When the brief's success criteria
> are met, open a PR titled `worktree-X: <one-line summary>`.

## After the parallel batch merges

Conflict-prone worktrees, sequenced:

- H: Element cropping and bounding-box overlays (touches every check + report)
- I: Rubric-driven check refactor (touches all 13 check modules)
- J: Vision-confirmation gate (touches orchestrate)
- K: Two-judge confidence routing (touches orchestrate)

Each is a separate worktree off the latest main, run alone. Brief them
later with the same template.

## Cost guardrails

Seven sessions running simultaneously = seven streams of Anthropic calls.
Greenfield file creation is mostly cheap (no big tool loops) but autonomous
sessions can rack up cost if they get stuck. Recommendations:

- Set a per-day spend cap on the Anthropic account.
- Check on each session every 30-60 minutes for the first few hours.
- If a session starts looping (rereading the same files, retrying the same
  failing test), interrupt it and clarify the brief.

## What if a session asks a clarifying question

That's a sign the brief was missing something. Three options:

1. Answer in chat, then update the brief on main so other sessions benefit.
2. Tell the session "make a reasonable assumption, document it in the PR
   description, we'll review."
3. Stop the session and update the brief, then restart with the new context.

Option 1 is best when the question is real. Option 2 is best when the
question is overthinking. Option 3 is best when you realize the brief
fundamentally needs rethinking.
