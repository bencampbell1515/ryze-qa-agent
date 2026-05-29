import type { Timestamp } from "firebase/firestore";
import type { ScanConfig } from "./scan-config";

export type RunStatus =
  | "requested"
  | "running"
  | "complete"
  | "failed"
  | "cancelled"
  | "cancel-requested";

export type RunStep = "queued" | "crawl" | "audit" | "orchestrate" | "done";

export type Run = {
  id: string;
  status: RunStatus;
  step: RunStep;
  progress: number; // 0..100
  requestedBy: string;
  requestedAt: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  note?: string;
  bugCount?: number;
  urlCount?: number;
  urlsScanned?: number;
  reportPath?: string; // gs:// path
  pdfPath?: string;    // gs:// path
  logTail?: string[];
  errorMessage?: string;
  scanConfig?: ScanConfig;
  bugsJsonPath?: string; // gs:// path to scored-bugs.json (used by diff view)
  systemHealthPath?: string; // gs:// path to system-health.md (dr-marcus-chen meta-analysis)

  // v2 rebuild artifacts (worktree N1 daemon uploads). gs:// paths to the
  // structured Finding streams + per-finding crops, plus their counts. Counts
  // are always written (0 when absent); path fields are present only when the
  // file existed on disk. Older runs predating N1 have none of these — the
  // dashboard hides the corresponding sections when count is 0/undefined.
  findingsJsonPath?: string;           // gs:// → reports/<runId>/findings.jsonl
  uncertainFindingsJsonPath?: string;  // gs:// → reports/<runId>/uncertain-findings.jsonl
  suppressedFindingsJsonPath?: string; // gs:// → reports/<runId>/suppressed-findings.jsonl
  hygieneJsonPath?: string;            // gs:// → reports/<runId>/hygiene.jsonl
  cropsPrefix?: string;                // gs:// → reports/<runId>/crops/ (trailing slash)
  findingsCount?: number;
  uncertainCount?: number;
  suppressedCount?: number;
  hygieneCount?: number;
  cropsCount?: number;
};

// ---------------------------------------------------------------------------
// v2 Finding types — mirrored from the main repo's canonical contract at
// `src/types/finding.ts`. The daemon (worktree N1) uploads exactly these shapes
// as JSONL, so the dashboard must parse the full canonical fields, not a
// simplified subset. NOTE: this intentionally diverges from the worktree-N2
// brief's inline types, which were lossy (HygieneFinding.detail typed as string
// rather than Record, missing rubricId/judgeModel/viewport/etc.). See the N2 PR
// description for the divergence rationale.
// ---------------------------------------------------------------------------

export type FindingSeverity = "critical" | "high" | "medium" | "low";

export type FindingSource =
  | "deterministic"
  | "persona"
  | "rubric"
  | "cross-page"
  | "visual-regression"
  | "journey";

export type FindingVerdict = "pass" | "fail" | "uncertain";

export type FindingViewport = "desktop" | "tablet" | "mobile";

export interface ElementRef {
  ref?: string;
  selector?: string;
  role?: string;
  name?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface ElementCrop {
  /** Path relative to /output/crops/, e.g. "<runId>/<findingId>.png". May also
   *  arrive as an absolute capture path or a bare filename — use
   *  `cropDownloadPath()` to resolve against `run.cropsPrefix`. */
  path: string;
  width: number;
  height: number;
  padding: number;
  boundingBoxDrawn: boolean;
}

export interface RubricVerdict {
  rubricId: string;
  dimension: string;
  verdict: FindingVerdict;
  confidence: number;
  discrepancy?: string;
  judgeModel: string;
}

export interface VisualGateVerdict {
  verdict: "visible" | "uncertain" | "not-visible";
  reason: string;
  judgeModel: string;
}

export interface Finding {
  id: string;
  fingerprint: string;
  runId: string;
  discoveredAt: string; // ISO 8601

  ruleId: string;
  category: string;
  source: FindingSource;
  severity: FindingSeverity;

  url: string;
  relatedUrls?: string[];
  viewport?: FindingViewport;
  element?: ElementRef;

  crop?: ElementCrop;
  fullPageScreenshotPath?: string;
  rubricVerdicts?: RubricVerdict[];
  visualGate?: VisualGateVerdict;

  title: string;
  description: string;
  remediation?: string;

  confidence: number;
  consensusCount?: number;
  uncertain?: boolean;

  score?: number;

  meta?: Record<string, string | number | boolean | null>;
}

export type HygieneReason =
  | "deny-list-match"
  | "shopify-draft"
  | "shopify-archived"
  | "shopify-not-found"
  | "shopify-unlisted"
  | "duplicate-handle"
  | "stale-replo";

export interface HygieneFinding {
  id: string;
  runId: string;
  discoveredAt: string;
  reason: HygieneReason;
  url: string;
  detail?: Record<string, string>;
}

export type RunEvent = {
  id: string;
  ts: Timestamp;
  level: "info" | "warn" | "error";
  message: string;
};

export type BugSummary = {
  key: string;            // fingerprint or fallback key
  ruleId?: string;
  severity?: string;
  description?: string;
  url?: string;
};

export type SemanticPair = {
  keyA: string;
  keyB: string;
  confidence: number;     // 0..1
  reason: string;
  // denormalized copies so the diff doc is self-contained for rendering
  bugA: BugSummary;
  bugB: BugSummary;
};

export type DiffStatus =
  | "requested"
  | "running-exact"
  | "running-semantic"
  | "complete"
  | "failed";

export type DiffRequest = {
  id: string;
  runIdA: string;
  runIdB: string;
  requestedBy: string;
  requestedAt: Timestamp;
  status: DiffStatus;
  completedAt?: Timestamp;
  errorMessage?: string;
  // Results — populated progressively as the daemon advances
  exactOnlyA?: BugSummary[];   // candidates for "resolved"
  exactOnlyB?: BugSummary[];   // candidates for "new"
  exactBoth?:  BugSummary[];   // recurring (exact-match)
  semanticPairs?: SemanticPair[]; // pairs found via Haiku
  semanticSkipped?: string;    // reason if semantic was not run (e.g. no API key)
};
