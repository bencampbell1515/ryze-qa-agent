import type { Rubric } from './types.js';

/**
 * Targets the `discovery:wrong-product-displayed` false positive from the May 28
 * audit: Shopify redirects unavailable products to a fallback page, so the
 * displayed product legitimately differs from the URL handle. The bug is only
 * real when an ACTIVE product URL renders a different product with no redirect.
 *
 * The standalone check that fires this rubric MUST supply `pageContext.redirected`
 * (boolean) and `pageContext.urlHandle` (the requested product slug) — Playwright
 * exposes the redirect chain via `response.request().redirectedFrom()`, which no
 * other check captured before worktree I.
 */
export const wrongProductRubric: Rubric = {
  id: 'wrong-product-v1',
  label: 'Product displayed matches the URL or a legitimate redirect',
  context:
    'When a shopper visits a product URL, they expect the displayed product to ' +
    'match. Shopify redirects unavailable products to a fallback page; that is ' +
    'by-design. The bug is when an ACTIVE product URL renders a different ' +
    'product without a redirect.',
  ruleId: 'rubric:wrong-product-displayed',
  category: 'revenue',
  severity: 'high',
  dimensions: [
    {
      id: 'product-matches-url-or-redirect-occurred',
      description:
        'Whether the displayed product matches the requested URL handle, OR ' +
        'whether a redirect chain explains the mismatch.',
      passCriteria:
        'Page context shows a redirect chain (pageContext.redirected=true) — ' +
        'by-design Shopify behavior. OR the displayed product name matches the ' +
        'URL slug (pageContext.urlHandle).',
      failCriteria:
        'pageContext.redirected=false AND the displayed product name does not ' +
        'match the URL slug.',
    },
  ],
};
