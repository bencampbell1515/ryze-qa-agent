# Kickoff Prompts (Copy-Paste Per Worktree)

One prompt per worktree. After you `cd` into the worktree directory and
start Claude Code, paste the matching prompt verbatim. Don't elaborate; the
brief is the spec.

---

## Worktree A

```
You are doing worktree A. Read tasks/worktree-A-crawl-scope.md, then src/types/finding.ts, then docs/check-author-guide.md, then CLAUDE.md and README.md for repo context. Build the worktree per the brief. Do not modify any file outside the paths the brief lists. Commit frequently. When the brief's success criteria are met, open a PR titled "worktree-A: crawl scope filtering + Shopify status".
```

---

## Worktree B

```
You are doing worktree B. Read tasks/worktree-B-link-integrity.md, then src/types/finding.ts, then docs/check-author-guide.md, then CLAUDE.md and README.md for repo context. Build the worktree per the brief. Do not modify any file outside the paths the brief lists. Commit frequently. When the brief's success criteria are met, open a PR titled "worktree-B: lychee link integrity".
```

---

## Worktree C

```
You are doing worktree C. Read tasks/worktree-C-language-detection.md, then src/types/finding.ts, then docs/check-author-guide.md, then CLAUDE.md and README.md for repo context. Build the worktree per the brief. Do not modify any file outside the paths the brief lists. Commit frequently. When the brief's success criteria are met, open a PR titled "worktree-C: language detection for mixed-locale pages".
```

---

## Worktree D

```
You are doing worktree D. Read tasks/worktree-D-content-rules.md, then src/types/finding.ts, then docs/check-author-guide.md, then CLAUDE.md and README.md for repo context. Build the worktree per the brief. Do not modify any file outside the paths the brief lists. Commit frequently. When the brief's success criteria are met, open a PR titled "worktree-D: content rules (copyright, brand terms, URL typos)".
```

---

## Worktree E

Worktree E imports from worktree B's `src/cross-page/links-journey-helper.ts`.
If B has not merged to main yet, the brief tells the session to stub it.

```
You are doing worktree E. Read tasks/worktree-E-journey-tests.md, then src/types/finding.ts, then docs/check-author-guide.md, then CLAUDE.md and README.md for repo context. Check whether src/cross-page/links-journey-helper.ts exists on main (worktree B delivers it). If yes, import it. If no, stub it as instructed in the brief and document the dependency in the PR. Build the worktree per the brief. Do not modify any file outside the paths the brief lists. Commit frequently. When done, open a PR titled "worktree-E: journey tests for checkout, cart continuity, language switcher".
```

---

## Worktree F

```
You are doing worktree F. Read tasks/worktree-F-visual-regression.md, then src/types/finding.ts, then docs/check-author-guide.md, then CLAUDE.md and README.md for repo context. Build the worktree per the brief. Do not implement GCS-backed baseline storage (deferred). Do not modify any file outside the paths the brief lists. Commit frequently. When the brief's success criteria are met, open a PR titled "worktree-F: visual regression scaffolding".
```

---

## Worktree G

Worktree G depends on the real business address being filled into
`config/canonical-record.json`. Verify that field is not the
"REPLACE WITH..." placeholder before kicking off.

```
You are doing worktree G. Read tasks/worktree-G-entity-consistency.md, then src/types/finding.ts, then docs/check-author-guide.md, then CLAUDE.md and README.md for repo context. Build the worktree per the brief. Stay in pure-JS regex extraction for the MVP path; LLM-assisted extraction is gated behind a config flag per the brief. Do not modify any file outside the paths the brief lists. Commit frequently. When the brief's success criteria are met, open a PR titled "worktree-G: entity consistency for addresses, emails".
```

---

## If a session goes off the rails

Three sane interventions:

1. "Stop. Re-read tasks/worktree-X-*.md. The brief is the spec; if you
   disagree with it, document the disagreement in the PR rather than
   working around it."

2. "Stop. You are modifying files outside the brief's scope. List the
   files you've touched, then revert anything outside the allowed paths."

3. "Stop. Open the PR with what you have and a description of where you
   got stuck. We'll move forward from there."

Option 3 is underused. A 60%-done PR with honest gaps is better than a
session that's been stuck for an hour pretending it's almost done.
