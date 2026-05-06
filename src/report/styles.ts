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
}
`;
