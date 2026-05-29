import { join } from 'node:path';
import type { Finding } from '../types/finding.js';

/**
 * Canonical path for a finding's crop within the output directory.
 *
 *   <outputDir>/crops/<runId>/<findingId>.png
 *
 * Keeps crops grouped per run, easy to clean up, and the path mirrors the
 * Finding ID so debugging is trivial.
 */
export function cropPath(outputDir: string, finding: Pick<Finding, 'id' | 'runId'>): string {
  return join(outputDir, 'crops', finding.runId, `${finding.id}.png`);
}
