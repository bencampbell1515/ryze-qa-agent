import type { Finding, Source } from '../types/finding.js';

/**
 * Vision-confirmation gate (worktree J).
 *
 * Where the v1 visual gate (`src/llm/visual-gate.ts`) asks "is this element
 * visible to a shopper?", the J gate asks a semantic question: "is this
 * finding's CLAIM true, given the rendered crop?". It validates deterministic
 * findings before they reach `data/findings.jsonl`, suppressing the
 * false-positive classes (async-loaded title flagged "missing", slow-but-valid
 * CDN image flagged "broken", a 304 flagged "failed") that don't justify their
 * own rubric.
 */

export type GateVerdict = 'confirmed' | 'refuted' | 'uncertain';

export interface GateResult {
  verdict: GateVerdict;
  /** Model confidence in the verdict, 0.0–1.0. */
  confidence: number;
  /** One-line explanation from the model. Required for refuted/uncertain. */
  reasoning?: string;
  /** The Claude model that produced this verdict (or a sentinel for the
   *  no-crop / soft-failure paths that never called a model). */
  judgeModel: string;
}

export interface GateInput {
  finding: Finding;
  /** Absolute path to the element crop. If undefined (or the file is missing),
   *  the gate returns `uncertain` — it can't validate what it can't see. */
  cropPath?: string;
  /** Page-level context for the model (URL, viewport, redirect info, …). */
  pageContext?: Record<string, string | number | boolean | null>;
  /** Model override for testing. Defaults to `claude-sonnet-4-6`. */
  judgeModel?: string;
  /** Optional API client injection for testing. In production the gate builds
   *  one from ANTHROPIC_API_KEY. */
  client?: import('@anthropic-ai/sdk').default;
  /** Override base retry delay (default 1000ms). Tests use 1ms. */
  retryDelayMs?: number;
}

export interface GateConfig {
  /** Severities that get gated. Default ['critical', 'high']. */
  severityFloor?: Array<Finding['severity']>;
  /** Categories to skip gating (already covered by rubrics, etc.). */
  excludeCategories?: string[];
  /** Finding sources to skip gating. Default ['rubric'] — rubric findings were
   *  already LLM-judged by worktree I; re-judging them wastes a call. */
  excludeSources?: Source[];
  /** Maximum concurrent gate calls. Default 5. */
  concurrency?: number;
  /** Where suppressed findings are logged for reviewer auditability.
   *  Default `data/suppressed-findings.jsonl`. runGateBatch is the sole writer. */
  suppressedPath?: string;
  /** Confidence at or above which a `refuted` verdict suppresses the finding.
   *  Below it, the finding is kept but marked uncertain. Default 0.8. */
  suppressThreshold?: number;
  /** Optional injected API client for testing; forwarded to every evaluateGate call. */
  client?: import('@anthropic-ai/sdk').default;
  /** Override base retry delay (default 1000ms). Tests use 1ms. */
  retryDelayMs?: number;
}
