---
description: How to assemble the .docx report from deduplicated bugs
---

## Report Structure

1. **Cover page** — sites audited, crawl date, total pages, total unique bugs.
2. **Severity summary table** — Critical/High/Medium/Low counts x bug class.
3. **Revenue-impact section** — bugs matching ruleId prefix `revenue:` promoted here.
4. **Bug detail pages** (sorted: Critical first, then High/Medium/Low):
   - BUG-<fingerprint[0:8]> heading
   - Severity, class, affected URL count, affected viewports
   - Plain-English description
   - Annotated full-page screenshot (max 600px wide)
   - Element close-up screenshot (max 400px wide)
   - Bulleted list of affected URLs
   - Fix guidance (use axe violation.helpUrl when available)
5. **Appendix** — raw JSON of all BugRecords.

## Assembly Command
`scripts/report.ts` reads `data/bugs.jsonl`, deduplicates, then calls `src/report/docx-builder.ts`,
writing to `output/audit-report-YYYY-MM-DD.docx`.
