import type { ScoredBug, Severity } from '../types.js';
import type { Finding, HygieneFinding, RubricVerdict } from '../types/finding.js';
import type { ReportTiers } from './finding-reader.js';
import { getCroppedScreenshot, getCroppedScreenshotForFinding } from './screenshot-cropper.js';
import { STYLES } from './styles.js';

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};

/**
 * Numeric confidence badge, color-coded by band (worktree L):
 * green ≥ 0.8, yellow 0.5–0.79, red < 0.5. Returns '' for an absent score so
 * legacy records (which may not carry confidence) render unchanged.
 */
function confidenceBadge(confidence: number | undefined): string {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return '';
  const band = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
  const pct = Math.round(confidence * 100);
  return `<span class="confidence-badge ${band}" title="confidence">${pct}%</span>`;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const safeSrc = (u: string): string => (/^https?:\/\//i.test(u) ? u : '#');

export function urlListHtml(urls: string[]): string {
  const visible = urls.slice(0, 5);
  const overflow = urls.slice(5);

  const renderLinks = (list: string[]) =>
    list.map((u) => `<a href="${escapeHtml(safeSrc(u))}" target="_blank" rel="noopener">${escapeHtml(u)}</a>`).join('\n');

  if (overflow.length === 0) {
    return `<div class="url-list">${renderLinks(visible)}</div>`;
  }

  return `<div class="url-list">${renderLinks(visible)}</div>
<div class="url-overflow hidden">${renderLinks(overflow)}</div>
<button class="show-more-btn" onclick="toggleMore(this)" data-count="${overflow.length}">+ ${overflow.length} more</button>`;
}

async function cardHtml(bug: ScoredBug): Promise<string> {
  const screenshot = await getCroppedScreenshot(bug);
  // Tier label: element crops (worktree-H tight crops with a drawn bounding box)
  // are the reviewer-preferred artifact; the top-slice fallback ('crop') and
  // full-page ('full') are labeled so reviewers know they're seeing a fallback.
  const tierLabel =
    screenshot?.tier === 'element' ? ' · flagged element'
    : screenshot?.tier === 'full' ? ' · full page'
    : '';
  const screenshotHtml = screenshot
    ? `<figure class="screenshot">
        <img src="${screenshot.dataUri}" alt="Screenshot showing the bug">
        <figcaption>${escapeHtml(screenshot.viewport)} viewport${tierLabel}</figcaption>
      </figure>`
    : '';

  const summary = escapeHtml(bug.summary ?? bug.description.slice(0, 200));

  const verifyBadge = bug.verificationStatus && bug.verificationStatus !== 'unverified'
    ? `<span class="verify-badge ${escapeHtml(bug.verificationStatus)}">${escapeHtml(
        bug.verificationStatus === 'confirmed' ? '✓ Confirmed'
        : bug.verificationStatus === 'could-not-reproduce' ? '✗ Could not reproduce'
        : '? Inconclusive'
      )}</span>`
    : '';

  return `<div class="card" data-severity="${bug.severity}">
  <div class="card-header">
    <span class="badge ${bug.severity}">${escapeHtml(SEVERITY_LABEL[bug.severity].toUpperCase())}</span>
    <code class="rule-id">${escapeHtml(bug.ruleId)}</code>
    ${verifyBadge}
    ${confidenceBadge(bug.confidence)}
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

// ── worktree-L: v2 Finding tiers (uncertain + hygiene) ──────────────────────

const VERDICT_CLASS: Record<RubricVerdict['verdict'], string> = {
  fail: 'rubric-verdict-fail', pass: 'rubric-verdict-pass', uncertain: 'rubric-verdict-uncertain',
};

/** Collapsed two-judge reasoning panel. K stores the merged reasoning as
 *  "[modelA] … | [modelB] …" in visualGate.reason and the model pair in
 *  visualGate.judgeModel; we split on " | " to show one row per judge. */
function judgeReasoningHtml(finding: Finding): string {
  const gate = finding.visualGate;
  if (!gate || !gate.reason) return '';
  const rows = gate.reason.split(' | ').map((seg) => {
    const m = seg.match(/^\[([^\]]+)\]\s*(.*)$/);
    const model = m ? m[1] : gate.judgeModel;
    const text = m ? m[2] : seg;
    return `<div class="judge-row"><span class="judge-model">${escapeHtml(model)}</span> ${escapeHtml(text)}</div>`;
  });
  return `<details class="judge-reasoning">
    <summary>Two-judge reasoning (${escapeHtml(gate.judgeModel)})</summary>
    ${rows.join('\n')}
  </details>`;
}

/** Per-dimension rubric verdicts (worktree I findings carry these). */
function rubricVerdictsHtml(finding: Finding): string {
  if (!finding.rubricVerdicts || finding.rubricVerdicts.length === 0) return '';
  const rows = finding.rubricVerdicts.map((rv) => {
    const disc = rv.discrepancy ? ` — ${escapeHtml(rv.discrepancy)}` : '';
    return `<div class="rubric-row">
      <span class="rubric-dim">${escapeHtml(rv.dimension)}</span>
      <span class="${VERDICT_CLASS[rv.verdict]}">${escapeHtml(rv.verdict)}</span>
      <span>${disc}</span>
    </div>`;
  });
  return `<div class="rubric-verdicts">${rows.join('\n')}</div>`;
}

async function findingCardHtml(finding: Finding, opts: { uncertain?: boolean } = {}): Promise<string> {
  const shot = await getCroppedScreenshotForFinding(finding);
  // Always reference the crop path (worktree H/I provenance) so reviewers — and
  // the unit suite — can see which element was flagged even when the PNG isn't
  // co-located with the report (e.g. a portability-only render).
  const cropAttr = finding.crop?.path ? ` data-crop-path="${escapeHtml(finding.crop.path)}"` : '';
  const screenshotHtml = shot
    ? `<figure class="screenshot">
        <img src="${shot.dataUri}"${cropAttr} alt="Flagged element crop">
        <figcaption>${escapeHtml(shot.viewport)} viewport · flagged element</figcaption>
      </figure>`
    : finding.crop?.path
      ? `<figure class="screenshot">
        <img${cropAttr} alt="Flagged element crop (${escapeHtml(finding.crop.path)})">
        <figcaption>element crop: ${escapeHtml(finding.crop.path)}</figcaption>
      </figure>`
      : '';

  const reviewBadge = opts.uncertain ? `<span class="review-badge">REVIEW</span>` : '';
  const cardClass = opts.uncertain ? 'card tier-uncertain-card' : 'card';
  const urls = [finding.url, ...(finding.relatedUrls ?? [])];

  return `<div class="${cardClass}" data-severity="${finding.severity}">
  <div class="card-header">
    <span class="badge ${finding.severity}">${escapeHtml(SEVERITY_LABEL[finding.severity].toUpperCase())}</span>
    <code class="rule-id">${escapeHtml(finding.ruleId)}</code>
    ${reviewBadge}
    ${confidenceBadge(finding.confidence)}
  </div>
  <p class="summary">${escapeHtml(finding.title)}</p>
  <div class="urls">
    <div class="urls-label">Affected pages (${urls.length})</div>
    ${urlListHtml(urls)}
  </div>
  ${screenshotHtml}
  ${rubricVerdictsHtml(finding)}
  ${judgeReasoningHtml(finding)}
</div>`;
}

async function uncertainSectionHtml(findings: Finding[]): Promise<string> {
  const body = findings.length === 0
    ? `<p class="tier-empty">No findings need review — both judges agreed on everything else.</p>`
    : (await Promise.all(findings.map((f) => findingCardHtml(f, { uncertain: true })))).join('\n');
  return `<section class="tier-section tier-uncertain">
  <div class="section-heading">
    <h2 style="color:var(--medium)">Needs review</h2>
    <span class="count">${findings.length} finding${findings.length !== 1 ? 's' : ''}</span>
  </div>
  <hr class="section-rule">
  ${body}
</section>`;
}

function hygieneSectionHtml(hygiene: HygieneFinding[]): string {
  const items = hygiene.map((h) => {
    const detail = h.detail
      ? Object.entries(h.detail).map(([k, v]) => `${escapeHtml(k)}=${escapeHtml(String(v))}`).join(', ')
      : '';
    const detailHtml = detail ? ` <span class="hygiene-detail">(${detail})</span>` : '';
    return `<li>
      <span class="hygiene-reason">${escapeHtml(h.reason)}</span>
      <a class="hygiene-url" href="${escapeHtml(safeSrc(h.url))}" target="_blank" rel="noopener">${escapeHtml(h.url)}</a>${detailHtml}
    </li>`;
  });
  const body = hygiene.length === 0
    ? `<p class="tier-empty">No URLs were excluded by the scope filter for this run.</p>`
    : `<details class="hygiene-details">
    <summary>${hygiene.length} URL${hygiene.length !== 1 ? 's' : ''} excluded — click to review</summary>
    <ul class="hygiene-list">${items.join('\n')}</ul>
  </details>`;
  return `<section class="tier-section tier-hygiene">
  <div class="section-heading">
    <h2 style="color:var(--low)">Hygiene</h2>
    <span class="count">${hygiene.length} excluded</span>
  </div>
  <hr class="section-rule">
  ${body}
</section>`;
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
  gateInfo?: { degradedCount: number; totalGated: number },
  tiers?: ReportTiers,
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

  // worktree-L: when the rebuilt pipeline's tiers are supplied, the main bug list
  // is framed as "Main findings" and the uncertain + hygiene tiers are appended.
  // When `tiers` is omitted, output is byte-identical to the legacy report so
  // existing callers (audit-only path before wiring) are unaffected.
  const mainHeading = tiers
    ? `<div class="section-heading tier-heading"><h2>Main findings</h2><span class="count">${bugs.length} finding${bugs.length !== 1 ? 's' : ''}</span></div>`
    : '';
  const uncertainSection = tiers ? await uncertainSectionHtml(tiers.uncertain) : '';
  const hygieneSection = tiers ? hygieneSectionHtml(tiers.hygiene) : '';

  const banner = gateInfo && gateInfo.degradedCount > 0
    ? `<div style="background:#fff3cd;border:1px solid #ffe69c;color:#664d03;padding:0.75rem 1rem;border-radius:6px;margin:1rem 0;font-size:0.95rem;">
         ⚠ <strong>Visual gate degraded:</strong> ${gateInfo.degradedCount} of ${gateInfo.totalGated} records could not be validated by the LLM and were kept as uncertain. Rerun <code>npm run report</code> to retry.
       </div>`
    : '';

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
${banner}
<div class="tabs">
  <button class="tab active" id="tab-severity" onclick="showTab('severity')">By Severity</button>
  <button class="tab" id="tab-category" onclick="showTab('category')">By Category</button>
</div>
<main>
  ${mainHeading}
  <div id="view-severity" class="view">${sevView}</div>
  <div id="view-category" class="view hidden">${catView}</div>
  ${uncertainSection}
  ${hygieneSection}
</main>
<script>${INLINE_JS}</script>
</body>
</html>`;
}
