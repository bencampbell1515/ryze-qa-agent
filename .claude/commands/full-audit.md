---
description: Run a complete crawl → audit → report pipeline for both RYZE sites
---

Read CLAUDE.md to refresh constraints, then execute in sequence:

1. `npm run clean` — clear bugs.jsonl and tmp files from any prior run.
2. `npm run test:crawl` — discover URLs, write output/url-list.json. Report URL count.
3. `npm run test:audit` — run all checks across 3 viewports. Report pass/fail counts.
4. `npm run report` — deduplicate bugs.jsonl and build output/audit-report-<date>.docx.

After each phase, check for errors and surface blockers before proceeding.

When done, report:
- Total URLs crawled
- Unique bugs found (Critical / High / Medium / Low breakdown)
- Path to the generated .docx
