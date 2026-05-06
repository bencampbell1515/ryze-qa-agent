import type { ScoredBug, Severity } from '../types.js';
import { getCroppedScreenshot } from './screenshot-cropper.js';
import { STYLES } from './styles.js';

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function urlListHtml(urls: string[]): string {
  const visible = urls.slice(0, 5);
  const overflow = urls.slice(5);

  const renderLinks = (list: string[]) =>
    list.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(u)}</a>`).join('\n');

  if (overflow.length === 0) {
    return `<div class="url-list">${renderLinks(visible)}</div>`;
  }

  return `<div class="url-list">${renderLinks(visible)}</div>
<div class="url-overflow hidden">${renderLinks(overflow)}</div>
<button class="show-more-btn" onclick="toggleMore(this)" data-count="${overflow.length}">+ ${overflow.length} more</button>`;
}

async function cardHtml(bug: ScoredBug): Promise<string> {
  const screenshot = await getCroppedScreenshot(bug);
  const screenshotHtml = screenshot
    ? `<figure class="screenshot">
        <img src="${screenshot.dataUri}" alt="Screenshot showing the bug">
        <figcaption>${escapeHtml(screenshot.viewport)} viewport${screenshot.tier === 'full' ? ' · full page' : ''}</figcaption>
      </figure>`
    : '';

  const summary = escapeHtml(bug.summary ?? bug.description.slice(0, 200));

  return `<div class="card" data-severity="${bug.severity}">
  <div class="card-header">
    <span class="badge ${bug.severity}">${escapeHtml(SEVERITY_LABEL[bug.severity].toUpperCase())}</span>
    <code class="rule-id">${escapeHtml(bug.ruleId)}</code>
  </div>
  <p class="summary">${summary}</p>
  <div class="urls">
    <div class="urls-label">Affected pages (${bug.urls.length})</div>
    ${urlListHtml(bug.urls)}
  </div>
  ${screenshotHtml}
</div>`;
}

async function severityViewHtml(sorted: ScoredBug[]): Promise<string> {
  let html = '';
  for (const sev of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = sorted.filter((b) => b.severity === sev);
    if (group.length === 0) continue;
    const cards = await Promise.all(group.map(cardHtml));
    html += `<div class="severity-section">
  <div class="section-heading">
    <h2 style="color:var(--${sev})">${SEVERITY_LABEL[sev]}</h2>
    <span class="count">${group.length} finding${group.length !== 1 ? 's' : ''}</span>
  </div>
  <hr class="section-rule ${sev}">
  ${cards.join('\n')}
</div>`;
  }
  return html;
}

async function categoryViewHtml(sorted: ScoredBug[]): Promise<string> {
  const map = new Map<string, ScoredBug[]>();
  for (const bug of sorted) {
    const cat = bug.category ?? 'Other';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(bug);
  }

  const categories = [...map.entries()].sort(([catA, bugsA], [catB, bugsB]) => {
    const worstA = Math.min(...bugsA.map((x) => SEVERITY_ORDER[x.severity]));
    const worstB = Math.min(...bugsB.map((x) => SEVERITY_ORDER[x.severity]));
    return worstA !== worstB ? worstA - worstB : catA.localeCompare(catB);
  });

  let html = '';
  for (const [cat, bugs] of categories) {
    const subSorted = [...bugs].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.score - a.score,
    );
    const cards = await Promise.all(subSorted.map(cardHtml));
    html += `<div class="category-section">
  <h2 class="category-heading">${escapeHtml(cat)} <span class="count">(${bugs.length})</span></h2>
  ${cards.join('\n')}
</div>`;
  }
  return html;
}

const INLINE_JS = `
function showTab(name){
  document.querySelectorAll('.view').forEach(function(v){v.classList.add('hidden');});
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.getElementById('view-'+name).classList.remove('hidden');
  document.getElementById('tab-'+name).classList.add('active');
}
function toggleMore(btn){
  var ov=btn.previousElementSibling;
  var hidden=ov.classList.contains('hidden');
  ov.classList.toggle('hidden');
  btn.textContent=hidden?'− Show fewer':'+ '+btn.dataset.count+' more';
}`;

export async function buildHtml(
  bugs: ScoredBug[],
  meta: { crawlDate: string; totalPages: number; sites: string[] },
): Promise<string> {
  const sorted = [...bugs].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.score - a.score,
  );

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const b of bugs) counts[b.severity]++;

  const [sevView, catView] = await Promise.all([
    severityViewHtml(sorted),
    categoryViewHtml(sorted),
  ]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ryze QA Audit Report — ${escapeHtml(meta.crawlDate)}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <div class="brand">Ryze</div>
  <div class="report-title">QA Audit Report</div>
  <div class="meta">${escapeHtml(meta.crawlDate)} &nbsp;&middot;&nbsp; ${meta.totalPages} pages &nbsp;&middot;&nbsp; ${meta.sites.map(escapeHtml).join(', ')}</div>
  <div class="summary-bar">
    <span class="badge critical">${counts.critical} Critical</span>
    <span class="badge high">${counts.high} High</span>
    <span class="badge medium">${counts.medium} Medium</span>
    <span class="badge low">${counts.low} Low</span>
  </div>
</header>
<div class="tabs">
  <button class="tab active" id="tab-severity" onclick="showTab('severity')">By Severity</button>
  <button class="tab" id="tab-category" onclick="showTab('category')">By Category</button>
</div>
<main>
  <div id="view-severity" class="view">${sevView}</div>
  <div id="view-category" class="view hidden">${catView}</div>
</main>
<script>${INLINE_JS}</script>
</body>
</html>`;
}
