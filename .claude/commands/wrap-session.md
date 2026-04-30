# Wrap Session

Review this conversation and update the relevant docs for this project.

## Files to update

- [CLAUDE.md](../../CLAUDE.md) — root project context
- [docs/HISTORY.md](../../docs/HISTORY.md) — session fix logs and bug discoveries (create if needed)

## Routing

| Content type | File |
|---|---|
| New constraints, gotchas, or non-obvious behaviors | CLAUDE.md → **Key gotchas** |
| New noise patterns to exclude | CLAUDE.md → **Known noise** |
| Severity reclassifications | CLAUDE.md → **Severity ladder** |
| Bug fix log, root cause discoveries, session narrative | docs/HISTORY.md |
| New active bugs or blockers | CLAUDE.md → **Active bugs / constraints** (add section if needed) |
| Tech stack changes | CLAUDE.md → **Tech stack** |
| Command changes | CLAUDE.md → **Commands** |
| DOM selector corrections (price, ATC, etc.) | CLAUDE.md → **Key gotchas** |

## Rules

1. Update, don't duplicate — amend existing entries rather than adding new ones for the same topic.
2. Lessons over narrative in CLAUDE.md. Narrative and session history go in docs/HISTORY.md.
3. Active bugs: add new unfixed bugs, remove when resolved.
4. Keep CLAUDE.md under ~150 lines — move details to docs/HISTORY.md or setup.md if it grows.

## History entry format

```markdown
## Session (YYYY-MM-DD) — one-line summary
- ~~Problem~~ — fix or finding.
**Key insights:**
- Durable lesson worth remembering.
```

When done, report which files were updated and what was added.
