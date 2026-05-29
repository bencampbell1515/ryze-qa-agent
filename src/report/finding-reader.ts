import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, HygieneFinding } from '../types/finding.js';

/**
 * Read findings from disk for the report. Returns the three rendered tiers
 * (main, uncertain, hygiene) plus the suppressed pile (read for counts/tests,
 * not rendered as a fourth section — see the worktree-L brief).
 *
 * The main report still renders from the legacy bugs.jsonl/ScoredBug stream for
 * backward compat (orchestrate decorates those with LLM summaries/categories).
 * `tiers.main` here is the v2 Finding stream, exposed for completeness; the
 * uncertain + hygiene tiers are what L newly surfaces in the HTML.
 */
export interface ReportTiers {
  /** from data/findings.jsonl (K's "main" tier) */
  main: Finding[];
  /** from data/uncertain-findings.jsonl (K's two-judge "review if time" tier) */
  uncertain: Finding[];
  /** from data/suppressed-findings.jsonl — read for the count footnote, not rendered */
  suppressed: Finding[];
  /** from data/hygiene.jsonl (A's scope-filter + Shopify-status exclusions) */
  hygiene: HygieneFinding[];
}

/** A Finding line must at least carry its identity + rule for the report to do
 *  anything useful with it. Anything missing these is treated as malformed. */
function isFindingShaped(o: unknown): o is Finding {
  if (typeof o !== 'object' || o === null) return false;
  const f = o as Record<string, unknown>;
  return typeof f.id === 'string' && typeof f.ruleId === 'string';
}

/** A hygiene line needs a URL and a reason to be listable. */
function isHygieneShaped(o: unknown): o is HygieneFinding {
  if (typeof o !== 'object' || o === null) return false;
  const h = o as Record<string, unknown>;
  return typeof h.url === 'string' && typeof h.reason === 'string';
}

/**
 * Read a JSONL file into an array of validated records. Missing file → []. Each
 * line is parsed independently; a line that fails to parse or fails the shape
 * guard is logged to stderr and skipped — one bad line never sinks the read.
 */
function readJsonl<T>(path: string, guard: (o: unknown) => o is T): T[] {
  if (!existsSync(path)) return [];

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    process.stderr.write(`[finding-reader] could not read ${path}: ${(err as Error).message}\n`);
    return [];
  }

  const out: T[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      process.stderr.write(`[finding-reader] skipping malformed JSON at ${path}:${i + 1}\n`);
      continue;
    }
    if (!guard(parsed)) {
      process.stderr.write(`[finding-reader] skipping line with unexpected shape at ${path}:${i + 1}\n`);
      continue;
    }
    out.push(parsed);
  }
  return out;
}

/**
 * Read the report tiers from `dataDir`. Never throws: a missing directory or any
 * missing/partial file yields empty arrays for that tier. This keeps the report
 * renderable whether or not the rebuilt pipeline (K's gate, A's scope filter)
 * was active for the run.
 */
export async function readReportTiers(dataDir = 'data'): Promise<ReportTiers> {
  return {
    main: readJsonl<Finding>(join(dataDir, 'findings.jsonl'), isFindingShaped),
    uncertain: readJsonl<Finding>(join(dataDir, 'uncertain-findings.jsonl'), isFindingShaped),
    suppressed: readJsonl<Finding>(join(dataDir, 'suppressed-findings.jsonl'), isFindingShaped),
    hygiene: readJsonl<HygieneFinding>(join(dataDir, 'hygiene.jsonl'), isHygieneShaped),
  };
}
