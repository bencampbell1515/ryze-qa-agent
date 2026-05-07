# Wrap Session

Review this conversation and update the relevant docs for this project.

## Files to update

- [CLAUDE.md](../../CLAUDE.md) — root project context (constraints, architecture, cross-cutting gotchas)
- [tests/CLAUDE.md](../../tests/CLAUDE.md) — Playwright check modules and test-layer gotchas
- [scripts/CLAUDE.md](../../scripts/CLAUDE.md) — pipeline scripts, noise filter config, report/orchestrate gotchas
- [src/report/CLAUDE.md](../../src/report/CLAUDE.md) — report generation, dedup fingerprint details
- [docs/HISTORY.md](../../docs/HISTORY.md) — session fix logs and bug discoveries (create if needed)

## Routing

| Content type | File |
|---|---|
| Crawl-level constraints or bot/Cloudflare gotchas | CLAUDE.md → **Key gotchas** |
| Severity reclassifications | CLAUDE.md → **Severity ladder** |
| Tech stack changes | CLAUDE.md → **Tech stack** |
| Command changes | CLAUDE.md → **Commands** |
| Active bugs or current blockers | CLAUDE.md → **Active bugs / constraints** (add section if needed) |
| New noise rule IDs, noise hosts, or URL patterns | scripts/CLAUDE.md → **Known noise** |
| `report.ts` / `orchestrate.ts` / `reverify.ts` gotchas | scripts/CLAUDE.md → **Gotchas** |
| New script added or pipeline behavior changed | scripts/CLAUDE.md → **Key files** |
| Playwright-specific behavior, ATC timing, screenshot quirks | tests/CLAUDE.md → **Gotchas** |
| New check module added or behavior changed | tests/CLAUDE.md → **Key files** |
| HTML/PDF report rendering issues, dedup fingerprint changes | src/report/CLAUDE.md → **Gotchas** or **Patterns** |
| Bug fix log, root cause discoveries, session narrative | docs/HISTORY.md |

## Rules

1. Update, don't duplicate — amend existing entries rather than adding new ones for the same topic.
2. Lessons over narrative in CLAUDE.md files. Narrative and session history go in docs/HISTORY.md.
3. Active bugs: add new unfixed bugs, remove when resolved.
4. Keep root CLAUDE.md under ~100 lines — cross-cutting context only; details belong in subsystem CLAUDE.mds.

## History entry format

```markdown
## Fixed (YYYY-MM-DD) — one-line summary
- ~~Problem~~ — fix.
**Key insights:**
- Durable lesson worth remembering.
```

When done, report which files were updated and what was added.
