# SETUP — Read This First

Step-by-step to get from "I have this preflight bundle" to "seven Claude
Code sessions are building things in parallel."

## What's in this bundle

```
qa-rebuild-preflight/
├── PREFLIGHT.md                             ← you are here (was SETUP.md in the tarball)
├── src/types/finding.ts                     ← shared Finding interface
├── docs/check-author-guide.md               ← conventions every check follows
├── config/canonical-record.json             ← canonical values for assertions
├── config/scope-filter.json                 ← deny-list patterns
└── tasks/
    ├── 00-preflight.md                      ← what you commit to main first
    ├── _kickoff-prompts.md                  ← seven copy-paste prompts
    ├── worktree-A-crawl-scope.md
    ├── worktree-B-link-integrity.md
    ├── worktree-C-language-detection.md
    ├── worktree-D-content-rules.md
    ├── worktree-E-journey-tests.md
    ├── worktree-F-visual-regression.md
    └── worktree-G-entity-consistency.md
```

## Step 1: Drop the files into your repo

You're working in VS Code. Two ways to do this:

**Option A (recommended): let Claude Code do the whole preflight for you.**

1. Save the tarball somewhere known, e.g. `~/Downloads/qa-rebuild-preflight.tar.gz`.
2. Open your `ryze-qa-agent` repo in VS Code (`File → Open Folder` or
   `code ~/path/to/ryze-qa-agent` from any terminal).
3. Open VS Code's integrated terminal: `Terminal → New Terminal` (or
   `` Ctrl+` `` / `` Cmd+` ``).
4. Start a Claude Code session in that terminal.
5. Paste this prompt:

   ```
   Extract ~/Downloads/qa-rebuild-preflight.tar.gz into this repo root using
   --strip-components=1 so the contents merge into the existing directories.
   Then read PREFLIGHT.md and execute steps 3 through 7 (skip step 1, already
   done; I'll handle step 2 myself for the strategy doc). Stop before
   committing so I can review the diff.
   ```

   Claude Code will run the tar command, walk through CLAUDE.md and
   .env.example updates, verify TypeScript compiles, and stage the commit.
   Review the diff in VS Code's Source Control panel, then commit and push
   yourself.

**Option B: do it manually in the VS Code integrated terminal.**

```bash
# Already in the repo (you opened the folder), so cwd is the repo root.
tar -xzf ~/Downloads/qa-rebuild-preflight.tar.gz --strip-components=1

# Verify the files landed
ls -la src/types/finding.ts docs/check-author-guide.md config/ tasks/
```

`--strip-components=1` removes the `qa-rebuild-preflight/` wrapper so the
contents land directly at the repo root, merging into your existing `src/`
and `docs/` directories and creating new `tasks/` and `config/` ones.

If `src/types/` already exists with conflicting content, tar will fail
loudly; move or rename your existing one first.

After Option B, continue with steps 2 through 7 yourself.

## Step 2: Add the strategy doc as background reference

Save the strategy document (the one I wrote earlier in this conversation)
to `docs/rebuild-strategy.md`. Do NOT tell the worktree sessions to read
it. The briefs are the spec. The strategy doc is for you when you need
to remember why a decision was made.

If you only have the PDF version, save that as `docs/rebuild-strategy.pdf`
and link to it from a one-line note in `docs/check-author-guide.md` like:

> Background on the rebuild rationale lives in `docs/rebuild-strategy.pdf`
> (or `.md`). Read for context, not for instructions.

## Step 3: Update CLAUDE.md

Open `CLAUDE.md` at the repo root. Add this block AT THE TOP, before the
existing content:

```markdown
## For worktree sessions

If you are running in a worktree and the task is "build worktree X", your
first step is to read `tasks/worktree-X-*.md` for the specific spec, then
`src/types/finding.ts` for the shared interface, then
`docs/check-author-guide.md` for conventions. Only then read the rest of
this file.

The worktree brief is authoritative. If something in this file or
`README.md` conflicts with the brief, the brief wins. Surface the conflict
on the PR.
```

## Step 4: Update .env.example

Append these lines to `.env.example`:

```
# Shopify Admin API (worktree A)
SHOPIFY_SHOP_DOMAIN=
SHOPIFY_ADMIN_TOKEN=

# lychee binary path (worktree B). Defaults to "lychee" on PATH.
LYCHEE_BIN=lychee

# fastText / language detection (worktree C). Optional; default is in-process eld.
FASTTEXT_MODEL_PATH=

# Visual regression baseline storage (worktree F).
VISUAL_BASELINE_DIR=./baselines
VISUAL_BASELINE_GCS_BUCKET=
```

If you actually have valid values for `SHOPIFY_SHOP_DOMAIN` and
`SHOPIFY_ADMIN_TOKEN`, also add them to your real `.env` (which is
gitignored). Worktree A can't run without them.

## Step 5: Fill the canonical record

Open `config/canonical-record.json`. Replace
`"REPLACE WITH ACTUAL RYZE BUSINESS ADDRESS BEFORE RUNNING WORKTREE G"`
with the real business address(es).

If you don't know the canonical business address off the top of your head,
either find it (Shopify settings, the existing TOS page that has the bug)
or leave the placeholder and DON'T kick off worktree G yet. The other six
worktrees don't depend on this field.

Also confirm the brand variants list. Right now it includes `"Ryze"` which
means worktree D will flag pages that write the brand as "Ryze" instead of
"RYZE". If you want mixed casing to be acceptable, remove `"Ryze"` from
the `brandVariants` array.

## Step 6: Verify it compiles

In VS Code's integrated terminal:

```bash
npx tsc --noEmit
```

(Or whatever the repo's TypeScript check command is. Check `package.json`
scripts.) Confirm `finding.ts` has no syntax errors and no imports resolve
wrong.

If your `tsconfig.json` doesn't include `src/types/` already, it should
automatically because `src/**` is included. If you see an error, check
the `include` path.

## Step 7: Commit to main from VS Code

Two options, your call:

**Source Control panel (the visual way):**
1. Click the Source Control icon in the left sidebar (or `Ctrl+Shift+G` /
   `Cmd+Shift+G`).
2. Stage all the new and modified files (the `+` icon next to each, or
   `+` next to "Changes" to stage all).
3. Type the commit message: `preflight: shared contracts for worktree fan-out`
4. Click the checkmark to commit.
5. Click `...` → `Push` (or click the sync arrow in the status bar).

**Or from the integrated terminal:**

```bash
git add src/types/finding.ts
git add docs/check-author-guide.md
git add docs/rebuild-strategy.md    # or .pdf
git add config/canonical-record.json
git add config/scope-filter.json
git add tasks/
git add CLAUDE.md
git add .env.example

git commit -m "preflight: shared contracts for worktree fan-out"
git push origin main
```

The push is important. Worktrees branch off `origin/main`, not local main.

## Step 8: Create the seven worktrees

In your main repo's VS Code integrated terminal:

```bash
git worktree add ../ryze-qa-agent-A feature/worktree-A
git worktree add ../ryze-qa-agent-B feature/worktree-B
git worktree add ../ryze-qa-agent-C feature/worktree-C
git worktree add ../ryze-qa-agent-D feature/worktree-D
git worktree add ../ryze-qa-agent-E feature/worktree-E
git worktree add ../ryze-qa-agent-F feature/worktree-F
git worktree add ../ryze-qa-agent-G feature/worktree-G

# Verify
git worktree list
```

Each command creates a sibling directory next to your main repo with a
fresh branch checked out.

## Step 9: Copy your .env into each worktree

Still in the main repo's VS Code terminal:

```bash
for letter in A B C D E F G; do
  cp .env "../ryze-qa-agent-$letter/.env"
done
```

`.env` is not tracked by git, so it isn't shared across worktrees by
default. Worktrees A and G need it (Shopify, Claude API).

## Step 10: Install dependencies in each worktree

Still in the main repo's VS Code terminal:

```bash
for letter in A B C D E F G; do
  (cd "../ryze-qa-agent-$letter" && npm install)
done
```

Worktrees share `.git` but not `node_modules`. This takes a few minutes.
While it runs, open `tasks/_kickoff-prompts.md` in your current VS Code
window and have it ready.

## Step 11: Open each worktree as its own VS Code window

Seven separate VS Code windows, one per worktree. From the main repo's
integrated terminal:

```bash
for letter in A B C D E F G; do
  code "../ryze-qa-agent-$letter"
done
```

The `code` command opens a new VS Code window for each worktree. If you
don't have the `code` command on PATH, in VS Code press
`Cmd+Shift+P` / `Ctrl+Shift+P` → "Shell Command: Install 'code' command
in PATH" and run that once.

If you don't want all seven windows at once (it's a lot of context-
switching), start with three: A, C, D (smallest scope, fastest payback).
Open the rest later as you free up cognitive room.

Each worktree window opens with its own full VS Code state: file tree,
git integration, integrated terminal. They're completely independent.

## Step 12: Start Claude Code in each worktree window, paste the prompt

In each worktree VS Code window:

1. Open the integrated terminal (`Ctrl+`` / `Cmd+``).
2. Start your Claude Code session (`claude` command, or whatever you
   normally use to launch it inside VS Code).
3. Switch back to your original VS Code window briefly, open
   `tasks/_kickoff-prompts.md`, copy the matching prompt for that letter.
4. Switch to the worktree window, paste the prompt as your first message
   to Claude Code.

Watch the first 2-3 minutes of each session:
- Does it read the brief first? (It should `view tasks/worktree-X-*.md`)
- Does it ask clarifying questions about obvious things? (Bad sign;
  brief may need a tweak)
- Does it start creating files in the right place? (Good sign)

If a session looks confused in the first few minutes, interrupt early.
Easier to fix at minute 3 than at minute 30.

## Step 13: Watch and integrate

When a session opens a PR, review it. Watch for:

- Files outside the brief's allowed paths (most common error)
- Tests not added (most common omission)
- Findings not matching the canonical shape (the integration risk)

Merge in any order. Worktrees A through G don't depend on each other on
main (E depends on B at runtime, but the brief handles the missing-helper
case with a stub).

## After the parallel batch

The conflict-prone worktrees (H, I, J, K from the strategy doc) run
sequentially after the parallel batch merges. I haven't written briefs
for those yet; we'll do that once the parallel work lands and you can
see what the integrated codebase actually looks like.

## Troubleshooting

**A session is rereading the same files in a loop.** Interrupt. Ask it
to commit what it has and open a draft PR. Usually means the brief was
unclear about something specific; clarify in chat or amend the brief on
main and tell the session to pull.

**A session installed packages I didn't approve.** Check the brief's
"Dependencies" section. Worktrees B, C, D have specific allowed packages.
If a session added something else, push back on the PR.

**A session modified files outside the brief's scope.** That's a
revert-and-explain situation. The brief is explicit about boundaries.

**Two sessions modified the same file.** Shouldn't happen with these
briefs (they're scoped to non-overlapping directories), but if it does,
the merge conflict is on you to resolve. Look at the briefs' "Boundaries"
sections to determine which session was correct.

**Costs are climbing fast.** Check whether any session is in a verification
loop (running the full audit repeatedly). Tell it to skip the live dry-run
in the PR description and document the limitation; you'll verify yourself
when merging.
