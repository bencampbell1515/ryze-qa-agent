// src/scoring/evidence-enforcer.ts
import type { DiscoveryFinding } from '../types.js';

export interface EnforcerResult {
  valid: boolean;
  reason?: string;
}

export function enforceEvidence(finding: Partial<DiscoveryFinding>): EnforcerResult {
  if (!finding.url) return { valid: false, reason: 'missing url' };
  if (!finding.screenshot) return { valid: false, reason: 'missing screenshot' };
  if (!finding.quotedElement) return { valid: false, reason: 'missing quotedElement' };
  if (!finding.claim) return { valid: false, reason: 'missing claim' };
  return { valid: true };
}
