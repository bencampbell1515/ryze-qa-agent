# Wrap Session

Review this conversation and update the relevant docs for this project.

## Files to update

- [CLAUDE.md](../../CLAUDE.md) — root project context
- [tests/CLAUDE.md](../../tests/CLAUDE.md) — Playwright check modules and test-layer gotchas
- [src/report/CLAUDE.md](../../src/report/CLAUDE.md) — report generation, docx pitfalls, dedup details
- [docs/HISTORY.md](../../docs/HISTORY.md) — session fix logs and bug discoveries (create if needed)

## Routing

| Content type | File |
|---|---|
| New constraints or crawl-level gotchas | CLAUDE.md → **Key gotchas** |
| New noise patterns to exclude | CLAUDE.md → **Known noise** |
| Severity reclassifications | CLAUDE.md → **Severity ladder** |
| Tech stack changes | CLAUDE.md → **Tech stack** |
| Command changes | CLAUDE.md → **Commands** |
| Active bugs or current blockers | CLAUDE.md → **Active bugs / constraints** (add section if needed) |
| Playwright-specific behavior, ATC timing, screenshot quirks | tests/CLAUDE.md → **Gotchas** |
| New check module added or behavior changed | tests/CLAUDE.md → **Key files** |
| docx rendering issues, Word/Docs compatibility | src/report/CLAUDE.md → **Gotchas** |
| Dedup fingerprint changes, over-merge tuning | src/report/CLAUDE.md → **Patterns** |
| DOM selector corrections (price, ATC, etc.) | CLAUDE.md → **Key gotchas** |
| Bug fix log, root cause discoveries, session narrative | docs/HISTORY.md |

## Rules

1. Update, don't duplicate — amend existing entries rather than adding new ones for the same topic.
2. Lessons over narrative in CLAUDE.md files. Narrative and session history go in docs/HISTORY.md.
3. Active bugs: add new unfixed bugs, remove when resolved.
4. Keep CLAUDE.md under ~150 lines — move details to subsystem CLAUDE.mds if it grows.

## History entry format

```markdown
## Fixed (YYYY-MM-DD) — one-line summary
- ~~Problem~~ — fix.
**Key insights:**
- Durable lesson worth remembering.
```

When done, report which files were updated and what was added.
