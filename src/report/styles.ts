export const STYLES = `
:root {
  --critical: #CC0000;
  --high: #E65C00;
  --medium: #CC8800;
  --low: #666666;
  --brand: #1a3a6b;
  --bg: #f4f4f1;
  --card-bg: #ffffff;
  --border: #e2e8f0;
  --text: #1a1a1a;
  --text-secondary: #666;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.5; }

/* Header */
header { background: var(--brand); color: white; padding: 2rem 2.5rem; }
.brand { font-size: 0.7rem; letter-spacing: 0.25em; text-transform: uppercase; opacity: 0.6; margin-bottom: 0.2rem; }
.report-title { font-size: 1.8rem; font-weight: 700; margin-bottom: 0.2rem; }
.meta { font-size: 0.82rem; opacity: 0.65; margin-bottom: 1.25rem; }
.summary-bar { display: flex; gap: 0.6rem; flex-wrap: wrap; }

/* Badges */
.badge {
  display: inline-flex; align-items: center; padding: 0.28rem 0.7rem;
  border-radius: 999px; font-size: 0.75rem; font-weight: 700;
  color: white; letter-spacing: 0.03em;
}
header .badge { font-size: 0.82rem; padding: 0.35rem 0.85rem; }
.badge.critical { background: var(--critical); }
.badge.high { background: var(--high); }
.badge.medium { background: var(--medium); }
.badge.low { background: var(--low); }

.verify-badge { display: inline-block; font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 10px; margin-left: 6px; vertical-align: middle; }
.verify-badge.confirmed { background: #d1fae5; color: #065f46; }
.verify-badge.could-not-reproduce { background: #fee2e2; color: #991b1b; }
.verify-badge.inconclusive { background: #fef3c7; color: #92400e; }

/* Tabs */
.tabs { background: white; border-bottom: 2px solid var(--border); padding: 0 2rem; display: flex; }
.tab {
  background: none; border: none; padding: 0.9rem 1.4rem;
  font-size: 0.88rem; font-weight: 500; cursor: pointer;
  color: var(--text-secondary); border-bottom: 3px solid transparent;
  margin-bottom: -2px; font-family: var(--font);
  transition: color 0.15s, border-color 0.15s;
}
.tab:hover { color: var(--brand); }
.tab.active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }

/* Layout */
main { max-width: 860px; margin: 0 auto; padding: 2rem 1.5rem; }
.view.hidden { display: none; }

/* Severity sections */
.severity-section { margin-bottom: 2.5rem; }
.section-heading { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.6rem; }
.section-heading h2 { font-size: 1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.count { font-size: 0.8rem; color: var(--text-secondary); }
.section-rule { height: 2px; border: none; margin-bottom: 1.1rem; opacity: 0.5; }
.section-rule.critical { background: var(--critical); }
.section-rule.high { background: var(--high); }
.section-rule.medium { background: var(--medium); }
.section-rule.low { background: var(--low); }

/* Category sections */
.category-section { margin-bottom: 2.5rem; }
.category-heading {
  font-size: 1rem; font-weight: 700; color: var(--brand);
  padding-bottom: 0.5rem; margin-bottom: 1rem;
  border-bottom: 2px solid var(--border);
}

/* Finding cards */
.card {
  background: var(--card-bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 1.2rem 1.3rem; margin-bottom: 0.85rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.card-header { display: flex; align-items: center; gap: 0.65rem; margin-bottom: 0.8rem; }
.rule-id {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.78rem; color: var(--text-secondary);
  background: #f0f0ee; padding: 0.15rem 0.45rem; border-radius: 3px;
}
.summary { font-size: 0.93rem; line-height: 1.65; margin-bottom: 1rem; }

/* URLs */
.urls { margin-bottom: 1rem; }
.urls-label {
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--text-secondary); margin-bottom: 0.35rem;
}
.url-list a, .url-overflow a {
  display: block; font-size: 0.8rem; color: #0058cc;
  text-decoration: none; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; padding: 0.08rem 0;
}
.url-list a:hover, .url-overflow a:hover { text-decoration: underline; }
.url-overflow.hidden { display: none; }
.show-more-btn {
  background: none; border: none; color: #0058cc;
  font-size: 0.78rem; cursor: pointer; padding: 0.2rem 0;
  margin-top: 0.15rem; font-family: var(--font);
}
.show-more-btn:hover { text-decoration: underline; }

/* Screenshots */
.screenshot { margin-top: 0.9rem; }
.screenshot img {
  max-width: 100%; border: 1px solid var(--border);
  border-radius: 5px; display: block;
}
figcaption { font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.3rem; }

/* Confidence badge (worktree L) — numeric, color-coded by threshold */
.confidence-badge {
  display: inline-block; font-size: 0.7rem; font-weight: 700;
  padding: 2px 8px; border-radius: 10px; margin-left: auto;
  vertical-align: middle; letter-spacing: 0.02em;
}
.confidence-badge.high { background: #d1fae5; color: #065f46; }   /* ≥ 0.8 */
.confidence-badge.medium { background: #fef3c7; color: #92400e; } /* 0.5–0.79 */
.confidence-badge.low { background: #fee2e2; color: #991b1b; }    /* < 0.5 */

/* Tier sections (worktree L) */
.tier-section { margin: 2.5rem 0; }
.tier-section > .section-heading h2 { font-size: 1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.tier-empty { font-size: 0.85rem; color: var(--text-secondary); font-style: italic; padding: 0.4rem 0; }

/* Uncertain tier — yellow accent + REVIEW badge */
.tier-uncertain .section-rule { background: var(--medium); height: 2px; border: none; margin-bottom: 1.1rem; opacity: 0.6; }
.card.tier-uncertain-card {
  border-left: 4px solid var(--medium);
  background: #fffdf5;
}
.review-badge {
  display: inline-flex; align-items: center; padding: 0.28rem 0.7rem;
  border-radius: 999px; font-size: 0.72rem; font-weight: 700;
  background: var(--medium); color: white; letter-spacing: 0.05em;
}

/* Two-judge reasoning — collapsed by default, expandable */
.judge-reasoning { margin-top: 0.8rem; font-size: 0.82rem; }
.judge-reasoning > summary {
  cursor: pointer; font-weight: 600; color: var(--text-secondary);
  font-size: 0.78rem; padding: 0.3rem 0; list-style: revert;
}
.judge-reasoning > summary:hover { color: var(--brand); }
.judge-reasoning .judge-row { padding: 0.4rem 0.6rem; margin-top: 0.4rem; background: #f7f7f4; border-radius: 4px; border-left: 3px solid var(--border); }
.judge-reasoning .judge-model { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 0.72rem; color: var(--brand); font-weight: 600; }
.judge-reasoning .judge-verdict { font-weight: 700; text-transform: uppercase; font-size: 0.68rem; margin-left: 0.4rem; letter-spacing: 0.04em; }

/* Per-dimension rubric verdicts */
.rubric-verdicts { margin-top: 0.7rem; }
.rubric-verdicts .rubric-row { display: flex; gap: 0.5rem; align-items: baseline; font-size: 0.8rem; padding: 0.15rem 0; }
.rubric-verdicts .rubric-dim { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 0.72rem; color: var(--text-secondary); }
.rubric-verdicts .rubric-verdict-fail { color: var(--critical); font-weight: 700; }
.rubric-verdicts .rubric-verdict-pass { color: #065f46; font-weight: 700; }
.rubric-verdicts .rubric-verdict-uncertain { color: var(--medium); font-weight: 700; }

/* Hygiene tier — muted, collapsed by default */
.tier-hygiene .section-rule { background: var(--low); height: 2px; border: none; margin-bottom: 0.5rem; opacity: 0.4; }
.hygiene-details { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 1rem; }
.hygiene-details > summary { cursor: pointer; font-weight: 600; color: var(--text-secondary); font-size: 0.9rem; padding: 0.4rem 0; }
.hygiene-details > summary:hover { color: var(--brand); }
.hygiene-list { list-style: none; margin-top: 0.6rem; }
.hygiene-list li { display: flex; gap: 0.6rem; align-items: baseline; padding: 0.3rem 0; border-top: 1px solid var(--border); font-size: 0.82rem; }
.hygiene-reason { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 0.72rem; color: var(--low); background: #f0f0ee; padding: 0.1rem 0.4rem; border-radius: 3px; white-space: nowrap; }
.hygiene-url { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Print / PDF */
@media print {
  .tabs { display: none; }
  .view { display: block !important; }
  #view-category { display: none !important; }
  .url-overflow { display: block !important; }
  .show-more-btn { display: none; }
  .card { break-inside: avoid; }
  body { background: white; }
  header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Force-expand collapsed panels so the static PDF shows judge reasoning +
     hygiene exclusions — mirrors the .url-overflow print treatment above. */
  details { display: block !important; }
  details > summary { display: none !important; }
  .judge-reasoning, .hygiene-details { break-inside: avoid; }
}
`;
