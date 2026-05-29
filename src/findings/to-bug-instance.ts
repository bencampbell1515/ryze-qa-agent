import type { BugInstance, BugClass, Viewport } from '../types.js';
import type { Finding } from '../types/finding.js';

/**
 * Derive the legacy {@link BugInstance} shape from a {@link Finding}.
 *
 * In worktree M the check sites do NOT route bugs.jsonl through this function —
 * they keep their existing `bugs.add({...})` call untouched (side-by-side
 * dual-write) so bugs.jsonl is provably byte-identical. This adapter ships and
 * is unit-tested for two future uses:
 *   1. the eventual Finding-driven downstream (a later worktree), and
 *   2. re-deriving a BugInstance for the disabled checks if they are re-enabled.
 *
 * It is intentionally lossy: a BugInstance is a strictly poorer record than a
 * Finding. Fields with no v1 home are dropped (see "Dropped" below).
 *
 * ── Field mapping (Finding → BugInstance) ──────────────────────────────────
 *   ruleId                         → ruleId
 *   severity                       → severity
 *   category (+ meta.legacyBugClass) → bugClass   (see CATEGORY_TO_BUGCLASS)
 *   description                    → message      (the detailed human text)
 *   url                            → url
 *   viewport (default 'desktop')   → viewport
 *   element.selector               → selector
 *   meta.outerHtmlSnippet          → outerHTMLSnippet
 *   crop.path                      → elementScreenshot
 *   fullPageScreenshotPath         → pageScreenshot
 *   confidence                     → confidence
 *   discoveredAt                   → timestamp
 *
 * ── Dropped (no v1 BugInstance field; the legacy pipeline never used them) ──
 *   id, fingerprint (Finding's own), category, source, title, remediation,
 *   relatedUrls, element.{ref,role,name,boundingBox}, crop.{width,height,
 *   padding,boundingBoxDrawn}, rubricVerdicts, visualGate, consensusCount,
 *   uncertain, score, and any meta keys other than outerHtmlSnippet/legacyBugClass.
 */

/**
 * v2 Finding.category → v1 BugInstance.bugClass.
 *
 * The two enums diverge. BugClass = a11y | console | network | visual | seo |
 * revenue | content | lighthouse. Finding.category = revenue | seo | content |
 * network | i18n | cross-page | journey | visual-regression | hygiene (plus
 * ad-hoc prefixes like 'security' from some ruleIds).
 *
 * Categories with a direct bugClass map 1:1. Categories with no bugClass
 * equivalent map to the CLOSEST bugClass; the precise original is never lost
 * because buildFinding stamps the check's original bugClass into
 * meta.legacyBugClass, which takes precedence here when present.
 */
const CATEGORY_TO_BUGCLASS: Record<string, BugClass> = {
  // direct
  revenue: 'revenue',
  seo: 'seo',
  content: 'content',
  network: 'network',
  // no direct bugClass → closest
  i18n: 'content',
  'cross-page': 'content',
  journey: 'content',
  'visual-regression': 'visual',
  hygiene: 'content',
};

const VALID_BUGCLASSES: ReadonlySet<string> = new Set<BugClass>([
  'a11y',
  'console',
  'network',
  'visual',
  'seo',
  'revenue',
  'content',
  'lighthouse',
]);

const FALLBACK_BUGCLASS: BugClass = 'content';

function deriveBugClass(finding: Finding): BugClass {
  // meta.legacyBugClass wins when it names a real BugClass (exact round-trip).
  const legacy = finding.meta?.legacyBugClass;
  if (typeof legacy === 'string' && VALID_BUGCLASSES.has(legacy)) {
    return legacy as BugClass;
  }
  return CATEGORY_TO_BUGCLASS[finding.category] ?? FALLBACK_BUGCLASS;
}

export function toBugInstance(finding: Finding): BugInstance {
  const bug: BugInstance = {
    ruleId: finding.ruleId,
    severity: finding.severity,
    bugClass: deriveBugClass(finding),
    message: finding.description,
    url: finding.url,
    viewport: (finding.viewport ?? 'desktop') as Viewport,
    timestamp: finding.discoveredAt,
    confidence: finding.confidence,
  };

  if (finding.element?.selector) bug.selector = finding.element.selector;

  const outerHtml = finding.meta?.outerHtmlSnippet;
  if (typeof outerHtml === 'string') bug.outerHTMLSnippet = outerHtml;

  if (finding.crop?.path) bug.elementScreenshot = finding.crop.path;
  if (finding.fullPageScreenshotPath) bug.pageScreenshot = finding.fullPageScreenshotPath;

  return bug;
}
