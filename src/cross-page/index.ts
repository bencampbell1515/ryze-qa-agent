/**
 * Cross-page check manifest (barrel).
 *
 * docs/check-author-guide.md describes a manifest at src/cross-page/index.ts
 * that the orchestrator iterates to collect cross-page findings. No
 * orchestrator wiring consumes cross-page checks yet (this worktree must not
 * modify orchestrate), so for now this file is the public surface of the
 * cross-page layer: a barrel re-export plus a typed registry that a future
 * orchestrator integration can iterate.
 *
 * When orchestrate gains cross-page support, it should import
 * `crossPageChecks` from here. Adding a new cross-page check = append an entry.
 */
export {
  checkLinks,
  verifyLycheeInstalled,
  defaultExecutor,
  buildLycheeArgs,
} from './links.js';
export type {
  LinkCheckConfig,
  LinkCheckResult,
  BrokenLink,
  LycheeExecutor,
  ExecResult,
} from './links.js';

export { checkLinksInContainer } from './links-journey-helper.js';
export type { PageLike } from './links-journey-helper.js';

/**
 * Metadata describing a registered cross-page check. Kept intentionally light
 * until orchestrate defines a formal CheckContext for this layer.
 */
export interface CrossPageCheckEntry {
  /** Stable id for the check, used in logs and the manifest. */
  id: string;
  /** ruleIds this check can emit. */
  ruleIds: string[];
  /** One-line description. */
  description: string;
}

/** The cross-page checks available to the run. */
export const crossPageChecks: CrossPageCheckEntry[] = [
  {
    id: 'links',
    ruleIds: ['cross-page:broken-link', 'cross-page:broken-fragment'],
    description:
      'lychee-backed broken-link and broken-anchor-fragment detection across ' +
      'the full crawl, plus a journey helper for in-context link validation.',
  },
];
