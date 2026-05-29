import type Anthropic from '@anthropic-ai/sdk';
import type { Finding, RubricVerdict } from '../types/finding.js';
import type { CropTarget } from '../crops/types.js';
import type { Page } from '@playwright/test';

/**
 * One checkable dimension within a rubric. The model returns a verdict per
 * dimension. Keep dimensions narrow — a dimension should be answerable from the
 * cropped element plus the page context, with no open-ended judgement.
 */
export interface RubricDimension {
  /** Short ID, e.g. "currency-format-correct". */
  id: string;
  /** Plain-English description of what to check. */
  description: string;
  /** Optional: explicit pass criteria (what "good" looks like). */
  passCriteria?: string;
  /** Optional: explicit fail criteria (what triggers a bug). */
  failCriteria?: string;
}

/**
 * A rubric is a small written spec the model evaluates a rendered element
 * against. It converts open-ended "find bugs" judgement into bounded
 * comparison: "here is the element, here is what correct looks like, list
 * discrepancies".
 */
export interface Rubric {
  /** Stable rubric ID, e.g. "cart-summary-v1". */
  id: string;
  /** Short label for reports. */
  label: string;
  /** What this rubric evaluates. One-paragraph context for the model. */
  context: string;
  /** Per-dimension rules. */
  dimensions: RubricDimension[];
  /** ruleId this rubric emits findings under, e.g. "rubric:cart-subtotal-missing". */
  ruleId: string;
  /** Category and severity for findings. */
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Everything the runner needs to evaluate one element against one rubric.
 */
export interface RubricInput {
  /** The element being evaluated (a Playwright locator or pre-resolved box). */
  element: CropTarget;
  /** Optional page context the rubric needs (e.g. URL, redirect chain). */
  pageContext?: Record<string, string | number | boolean | null>;
  /** The page (for crop capture). */
  page: Page;
  /** Run ID for finding stamping. */
  runId: string;
  /** Where to write the crop file. */
  cropOutputDir: string;
  /** Optional model override for the judge. Defaults to claude-sonnet-4-6. */
  judgeModel?: string;
  /** Optional injected Anthropic client — used by tests; in production the
   *  runner constructs one from ANTHROPIC_API_KEY. */
  client?: Anthropic;
  /** Override base retry delay (default 1000ms). Tests use 1ms. */
  retryDelayMs?: number;
}

/**
 * The outcome of one rubric evaluation.
 */
export interface RubricResult {
  /** The Finding to emit (or null if every dimension passed, the element was
   *  not visible, or the LLM could not be reached after retries). */
  finding: Finding | null;
  /** All verdicts from the rubric pass, even passing ones (for debugging).
   *  Empty when the element was invisible or the LLM call failed. */
  verdicts: RubricVerdict[];
  /** The crop path captured during evaluation, for cache reuse. Empty string
   *  when no crop was captured (invisible element). */
  cropPath: string;
}
