/**
 * Canonical Finding interface for the RYZE QA agent.
 *
 * This is the contract every check module emits and every downstream stage
 * (validate, dedup, gate, score, report) consumes. If you are building a new
 * check in a worktree, your output MUST match this shape.
 *
 * Versioning: this is v2 of the Finding interface, designed for the rebuilt
 * pipeline. Legacy fields from the v1 bugs.jsonl format are preserved where
 * useful; new fields support element grounding, rubric judgments, and
 * cross-page references.
 *
 * Stability: this file lives on main. Worktrees import from it but do not
 * modify it. If a check genuinely needs a new field, propose the change in a
 * separate PR before merging the check.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Source =
  | 'deterministic'      // a Playwright check module fired
  | 'persona'            // an AI persona discovered it (legacy, being phased out)
  | 'rubric'             // a rubric-driven LLM check fired
  | 'cross-page'         // a cross-page consistency layer fired
  | 'visual-regression'  // a baseline diff fired
  | 'journey';           // a journey/flow test fired

export type Verdict = 'pass' | 'fail' | 'uncertain';

export type Viewport = 'desktop' | 'tablet' | 'mobile';

/**
 * Element reference grounded on the accessibility tree.
 * Mirrors the Playwright MCP / Stagehand ref pattern. Stable across runs as
 * long as the underlying element keeps its role + accessible name.
 */
export interface ElementRef {
  /** Stable accessibility-tree ref, e.g. "e5". Optional because some checks
   *  identify elements only by selector. */
  ref?: string;
  /** Playwright selector that resolves to this element. */
  selector?: string;
  /** ARIA role, e.g. "button", "link", "heading". */
  role?: string;
  /** Accessible name (the text a screen reader would announce). */
  name?: string;
  /** Bounding box in CSS pixels at capture time. */
  boundingBox?: { x: number; y: number; width: number; height: number };
}

/**
 * A cropped screenshot of the element under finding, with a bounding-box
 * overlay drawn for the reviewer. Worktrees that produce findings without
 * crops should leave this undefined; worktree H will backfill crops where
 * possible.
 */
export interface ElementCrop {
  /** Path relative to /output/crops/, e.g. "<runId>/<findingId>.png". */
  path: string;
  width: number;
  height: number;
  /** Padding applied around the element bounds, in CSS pixels. */
  padding: number;
  /** Whether a bounding box was drawn on top of the crop. */
  boundingBoxDrawn: boolean;
}

/**
 * A per-dimension verdict from a rubric-driven LLM check.
 * Multiple dimensions per check are allowed; multiple verdicts per finding
 * are allowed when multiple judges weighed in.
 */
export interface RubricVerdict {
  /** Rubric ID, e.g. "cart-summary-v1". */
  rubricId: string;
  /** Dimension being evaluated within the rubric, e.g. "subtotal-present". */
  dimension: string;
  /** Result of evaluating this dimension. */
  verdict: Verdict;
  /** Model confidence in this verdict (0-1). */
  confidence: number;
  /** One-line discrepancy text tied to the element. Required when verdict is 'fail'. */
  discrepancy?: string;
  /** Model identifier, e.g. "claude-sonnet-4-6". */
  judgeModel: string;
}

/**
 * Visual gate verdict (the original "is this visible to shoppers?" judgment).
 * Still emitted for backward compatibility, but rubric verdicts are preferred
 * because they encode intent, not just visibility.
 */
export interface VisualGateVerdict {
  verdict: 'visible' | 'uncertain' | 'not-visible';
  reason: string;
  judgeModel: string;
}

/**
 * The canonical Finding shape. Every check module emits one of these per issue.
 */
export interface Finding {
  // Identity
  /** Unique ID per finding. Recommended format: `f-${runId}-${shortHash}`. */
  id: string;
  /** Stable fingerprint for dedup across runs and for the dismissal list.
   *  Recommended formula:
   *  sha1(ruleId + ":" + canonicalUrl + ":" + elementSignature)
   *  where elementSignature is role + accessible name (NOT the selector). */
  fingerprint: string;
  /** Run ID this finding was emitted in. */
  runId: string;
  /** ISO 8601 timestamp. */
  discoveredAt: string;

  // Classification
  /** Check rule identifier, "category:slug" format. E.g. "revenue:cart-subtotal-missing". */
  ruleId: string;
  /** Top-level category. One of:
   *  revenue, seo, content, network, i18n, cross-page, journey,
   *  visual-regression, hygiene. */
  category: string;
  /** Origin layer that emitted this finding. */
  source: Source;
  /** Severity assigned by the check. The scoring layer may revise. */
  severity: Severity;

  // Where it lives
  url: string;
  /** For cross-page findings, additional URLs involved. */
  relatedUrls?: string[];
  /** Viewport in which the finding was observed. Omit for cross-page findings. */
  viewport?: Viewport;
  /** Element reference grounded on the accessibility tree. */
  element?: ElementRef;

  // Evidence
  /** Cropped screenshot of the element with a bounding box. */
  crop?: ElementCrop;
  /** Path to the full-page screenshot, for debugging only. Reports should
   *  prefer `crop`. */
  fullPageScreenshotPath?: string;
  /** Rubric verdicts that contributed to this finding. */
  rubricVerdicts?: RubricVerdict[];
  /** Legacy visual gate verdict. Leave undefined to let the gate run; set to
   *  pre-confirm and skip the gate. */
  visualGate?: VisualGateVerdict;

  // Content
  /** One-sentence plain-English summary, used as the finding headline in reports. */
  title: string;
  /** Longer description explaining the issue and its business impact. */
  description: string;
  /** Suggested remediation, if obvious. */
  remediation?: string;

  // Quality signals
  /** Overall confidence in this finding (0-1). */
  confidence: number;
  /** Number of independent sources or judges that agreed. */
  consensusCount?: number;
  /** True if the finding should land in the "uncertain" report tier rather
   *  than the main report. Set when two judges disagreed, or when confidence
   *  is below a threshold the check defines. */
  uncertain?: boolean;

  // Scoring (filled in by orchestrate, may be absent at emit time)
  score?: number;

  // Extensibility
  /** Free-form metadata specific to the check. Keep narrow. Strings, numbers,
   *  booleans, nulls only. Nested objects belong in a typed field, not here. */
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * A HygieneFinding is NOT a bug shown to the shopper. It is a system-health
 * observation about the audit process itself, e.g. "this URL exists in the
 * sitemap but is DRAFT in Shopify and was excluded from the audit."
 *
 * Hygiene findings appear in a separate report section so they don't pollute
 * the main bug list but remain visible for ongoing cleanup work.
 */
export interface HygieneFinding {
  id: string;
  runId: string;
  discoveredAt: string;
  reason:
    | 'deny-list-match'
    | 'shopify-draft'
    | 'shopify-archived'
    | 'shopify-not-found'
    | 'shopify-unlisted'
    | 'duplicate-handle'
    | 'stale-replo';
  /** The URL flagged. */
  url: string;
  /** Extra context: which deny-list pattern matched, what status Shopify
   *  returned, etc. */
  detail?: Record<string, string>;
}

/**
 * A canonical record for cross-page consistency assertions.
 * Lives in config/canonical-record.json; worktrees that need it import via
 * config loader, not by reading the file directly.
 */
export interface CanonicalRecord {
  businessAddresses: string[];
  supportEmail: string;
  brandName: string;
  brandVariants: string[];
  /** Years considered "current" for copyright assertions. Typically the
   *  current year and one year prior. */
  acceptableCopyrightYears: number[];
  /** Locale code to URL path prefix, e.g. { es: "/es/", fr: "/fr/" }. */
  localePathPrefixes: Record<string, string>;
  /** Canonical brand and product terms for edit-distance / typo checks. */
  brandTerms: string[];
}
