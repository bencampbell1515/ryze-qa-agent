/**
 * Template-level visual-regression baseline targets.
 *
 * We deliberately baseline by *template*, not by URL. RYZE has ~193 pages but
 * only ~8-12 distinct templates (homepage, PDP, collection, cart, blog, ...).
 * Per-URL pixel baselines across all pages are a maintenance trap; per-template
 * baselines (8-12 templates × up to 3 viewports ≈ 30 images) are tractable.
 *
 * Each template names ONE representative URL that exercises the layout. The
 * team edits this list as new templates surface (offer pages, bridge pages,
 * shop. subdomain, etc.) — see the PR notes for the recommended next additions.
 */

export interface Template {
  /** Stable template ID, e.g. "pdp", "collection". */
  id: string;
  /** Human label. */
  label: string;
  /** Representative URL for capture. */
  representativeUrl: string;
  /** Viewports to capture. */
  viewports: ('desktop' | 'tablet' | 'mobile')[];
  /** Selectors to mask before capture (dynamic regions). */
  maskSelectors: string[];
  /** Optional pre-capture wait, ms, beyond default. */
  extraWaitMs?: number;
}

export const TEMPLATES: Template[] = [
  {
    id: 'homepage',
    label: 'Homepage',
    representativeUrl: 'https://www.ryzesuperfoods.com/',
    viewports: ['desktop', 'tablet', 'mobile'],
    maskSelectors: [
      '[data-countdown]',
      '.countdown',
      '[data-viewers]',
      '[aria-label*="viewers"]',
    ],
  },
  {
    id: 'pdp',
    label: 'Product detail page',
    representativeUrl: 'https://www.ryzesuperfoods.com/products/ryze-mushroom-coffee',
    viewports: ['desktop', 'tablet', 'mobile'],
    maskSelectors: [
      '[data-countdown]',
      '.countdown',
      '.reviews-count', // review count changes daily
    ],
  },
  {
    id: 'collection',
    label: 'Collection / shop-all',
    representativeUrl: 'https://www.ryzesuperfoods.com/pages/shop-all',
    viewports: ['desktop', 'tablet', 'mobile'],
    maskSelectors: ['[data-countdown]', '.countdown'],
  },
  {
    id: 'cart',
    label: 'Cart',
    representativeUrl: 'https://www.ryzesuperfoods.com/cart',
    viewports: ['desktop', 'tablet', 'mobile'],
    maskSelectors: ['[data-countdown]', '.countdown'],
    // NOTE: an empty cart renders a near-blank page. A future iteration may
    // add an ATC pre-step so the cart baseline captures a populated cart; for
    // now the empty-cart layout is a stable enough baseline to start from.
  },
  {
    id: 'blog-post',
    label: 'Blog post',
    representativeUrl: 'https://www.ryzesuperfoods.com/blogs/recipes/ryze-affogato',
    viewports: ['desktop', 'mobile'],
    maskSelectors: ['[data-countdown]'],
  },
  {
    id: 'policy',
    label: 'Policy page',
    representativeUrl: 'https://www.ryzesuperfoods.com/policies/terms-of-service',
    viewports: ['desktop', 'mobile'],
    maskSelectors: [],
  },
  {
    id: 'landing-locale-es',
    label: 'Spanish locale landing',
    representativeUrl: 'https://www.ryzesuperfoods.com/pages/mushroom-coffee-espanol',
    viewports: ['desktop', 'mobile'],
    maskSelectors: ['[data-countdown]'],
  },
];

/** Look up a template by ID. Returns undefined when no template matches. */
export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
