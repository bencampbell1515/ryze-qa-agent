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
};

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
