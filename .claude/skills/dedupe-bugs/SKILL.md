---
description: The bug fingerprinting and deduplication algorithm
---

## Fingerprint Algorithm

`fingerprint = SHA1(ruleId + "|" + normalizedMessage + "|" + sectionAnchor + "|" + dHashHex.slice(0,16))`

### normalizedMessage
Strip URLs to path pattern: `Failed to load /products/ryze-blend-123.jpg` -> `Failed to load /products/*.jpg`
Strip hex IDs, numeric suffixes, dates.

### sectionAnchor
Walk up from offending element:
1. Stop at first ancestor matching: `[data-section-type]`, `[id^="shopify-section-"]`, class matching `/^(section|sec)-/`.
2. Build: `tag[data-section-type=VALUE]` (drop numeric id, keep type).
3. If no anchor found, use `document`.

### Merge Rules
- Exact fingerprint match -> same bug
- rule + normalizedMessage match AND dHash Hamming distance <= 4 -> same bug
