import type { ScoredBug } from '../../src/types.js';
import type { Finding, HygieneFinding } from '../../src/types/finding.js';
import type { ReportTiers } from '../../src/report/finding-reader.js';

/**
 * A representative all-tiers fixture for the worktree-L report: a mix of main
 * (ScoredBug) findings at every severity, two uncertain findings (one two-judge,
 * one rubric), and a handful of hygiene exclusions (A's scope filter + Shopify
 * status). Shared by the snapshot test and the sample-report generator so the
 * before/after PNGs render exactly what the test asserts on.
 */

export const SAMPLE_META = {
  crawlDate: '2026-05-29',
  totalPages: 231,
  sites: ['ryzesuperfoods.com', 'shop.ryzesuperfoods.com'],
};

export const SAMPLE_MAIN_BUGS: ScoredBug[] = [
  {
    fingerprint: 'm-crit-1', ruleId: 'revenue:cart-subtotal-nan', severity: 'critical', bugClass: 'revenue',
    title: 'Cart subtotal renders as NaN', description: 'After Add-to-Cart the drawer shows "$NaN" as the subtotal.',
    urls: ['https://www.ryzesuperfoods.com/products/mushroom-coffee'], viewports: ['desktop'], instanceCount: 1,
    score: 98, source: 'playwright', confidence: 0.97, consensusCount: 1, verificationStatus: 'confirmed',
    summary: 'After Add-to-Cart the cart drawer subtotal renders "$NaN" instead of a price — checkout is unusable.',
    category: 'Revenue',
  },
  {
    fingerprint: 'm-high-1', ruleId: 'content:broken-image', severity: 'high', bugClass: 'content',
    title: 'Hero image broken on PDP', description: 'The product hero <img> resolves to naturalWidth 0.',
    urls: ['https://www.ryzesuperfoods.com/products/mushroom-matcha'], viewports: ['mobile'], instanceCount: 1,
    score: 71, source: 'playwright', confidence: 0.82, consensusCount: 1,
    summary: 'The hero product image fails to load (naturalWidth 0) on the mobile PDP.',
    category: 'Content',
  },
  {
    fingerprint: 'm-med-1', ruleId: 'seo:missing-meta-description', severity: 'medium', bugClass: 'seo',
    title: 'Missing meta description', description: 'The collection page has no meta description tag.',
    urls: ['https://www.ryzesuperfoods.com/collections/all'], viewports: ['desktop'], instanceCount: 1,
    score: 40, source: 'playwright', confidence: 0.6, consensusCount: 1,
    summary: 'Collection page is missing a meta description, hurting search snippet quality.',
    category: 'SEO',
  },
  {
    fingerprint: 'm-low-1', ruleId: 'network:external-404', severity: 'low', bugClass: 'network',
    title: 'Broken external link', description: 'A footer partner link returns 404.',
    urls: ['https://www.ryzesuperfoods.com/pages/about'], viewports: ['desktop'], instanceCount: 1,
    score: 15, source: 'playwright', confidence: 0.45, consensusCount: 1,
    summary: 'A partner link in the footer returns HTTP 404.',
    category: 'Network',
  },
];

export const SAMPLE_UNCERTAIN: Finding[] = [
  {
    id: 'u-1', fingerprint: 'u-fp-1', runId: 'sample', discoveredAt: '2026-05-29T12:00:00.000Z',
    ruleId: 'revenue:countdown-stuck', category: 'revenue', source: 'deterministic', severity: 'high',
    url: 'https://www.ryzesuperfoods.com/products/mushroom-cacao',
    title: 'Countdown timer may be stuck at 00:00:00',
    description: 'A scarcity countdown reads 00:00:00; judges split on whether it is genuinely stuck or just expired this session.',
    confidence: 0.5, uncertain: true, viewport: 'desktop',
    crop: { path: 'sample/u-1.png', width: 320, height: 120, padding: 8, boundingBoxDrawn: true },
    visualGate: {
      verdict: 'uncertain',
      reason: '[claude-sonnet-4-6] timer shows 00:00:00, looks evergreen/stuck | [claude-opus-4-7] could be a genuinely expired one-off promo, not deceptive',
      judgeModel: 'claude-sonnet-4-6+claude-opus-4-7',
    },
  },
  {
    id: 'u-2', fingerprint: 'u-fp-2', runId: 'sample', discoveredAt: '2026-05-29T12:01:00.000Z',
    ruleId: 'revenue:discount-math', category: 'revenue', source: 'rubric', severity: 'medium',
    url: 'https://www.ryzesuperfoods.com/products/bundle',
    title: 'Bundle discount math may be inconsistent',
    description: 'The "17% off" badge and the displayed price disagree by a few cents.',
    confidence: 0.55, uncertain: true, viewport: 'desktop',
    crop: { path: 'sample/u-2.png', width: 280, height: 90, padding: 8, boundingBoxDrawn: true },
    rubricVerdicts: [
      { rubricId: 'discount-math-v1', dimension: 'badge-matches-price', verdict: 'fail', confidence: 0.55,
        discrepancy: '"17% off $30" should be $24.90 but shows $25.00', judgeModel: 'claude-sonnet-4-6' },
    ],
    visualGate: {
      verdict: 'uncertain',
      reason: '[claude-sonnet-4-6] rounding looks off by $0.10 | [claude-opus-4-7] within plausible rounding, low confidence',
      judgeModel: 'claude-sonnet-4-6+claude-opus-4-7',
    },
  },
];

export const SAMPLE_SUPPRESSED: Finding[] = [
  {
    id: 's-1', fingerprint: 's-fp-1', runId: 'sample', discoveredAt: '2026-05-29T12:02:00.000Z',
    ruleId: 'content:broken-image', category: 'content', source: 'deterministic', severity: 'high',
    url: 'https://www.ryzesuperfoods.com/pages/press',
    title: 'Image flagged broken but loads fine', description: 'Slow CDN image; both judges confirmed it renders.',
    confidence: 0.9,
    visualGate: { verdict: 'not-visible', reason: 'image is present and rendered', judgeModel: 'claude-sonnet-4-6+claude-opus-4-7' },
  },
];

export const SAMPLE_HYGIENE: HygieneFinding[] = [
  { id: 'h-1', runId: 'sample', discoveredAt: '2026-05-29T12:00:00.000Z', reason: 'shopify-draft',
    url: 'https://www.ryzesuperfoods.com/products/secret-launch', detail: { status: 'DRAFT' } },
  { id: 'h-2', runId: 'sample', discoveredAt: '2026-05-29T12:00:00.000Z', reason: 'deny-list-match',
    url: 'https://www.ryzesuperfoods.com/products/copy-of-mushroom-coffee', detail: { pattern: 'copy-of-*' } },
  { id: 'h-3', runId: 'sample', discoveredAt: '2026-05-29T12:00:00.000Z', reason: 'shopify-archived',
    url: 'https://www.ryzesuperfoods.com/products/2024-holiday-bundle', detail: { status: 'ARCHIVED' } },
];

export function sampleTiers(): ReportTiers {
  return {
    main: [],
    uncertain: SAMPLE_UNCERTAIN,
    suppressed: SAMPLE_SUPPRESSED,
    hygiene: SAMPLE_HYGIENE,
  };
}
