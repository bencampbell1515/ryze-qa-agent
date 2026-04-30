---
description: Run a complete crawl → audit → report pipeline for both RYZE sites
---

Read CLAUDE.md to refresh constraints, then execute in sequence:

1. `pnpm test:crawl` — discover URLs, write output/url-list.json. Report URL count.
2. `pnpm test:audit` — run all checks across 3 viewports. Report pass/fail counts.
3. `pnpm report` — deduplicate bugs.jsonl and build output/audit-report-<date>.docx.

After each phase, check for errors and surface blockers before proceeding.

When done, report:
- Total URLs crawled
- Unique bugs found (Critical / High / Medium / Low breakdown)
- Path to the generated .docx
