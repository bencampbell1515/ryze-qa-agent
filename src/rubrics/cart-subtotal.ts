import type { Rubric } from './types.js';

/**
 * Targets the `revenue:cart-subtotal-missing` false positive from the May 28
 * audit: the subtotal IS present, but the deterministic selector-based check
 * missed it (theme variation / selector quirk). This rubric verifies the
 * subtotal visually rather than by selector, so it can suppress the FP.
 */
export const cartSubtotalRubric: Rubric = {
  id: 'cart-subtotal-v1',
  label: 'Cart shows a line-item subtotal',
  context:
    'The cart summary should display a subtotal in currency format ($X.XX or ' +
    '$X,XXX.XX). This rubric verifies the subtotal is visible regardless of ' +
    'selector quirks or theme variations.',
  ruleId: 'rubric:cart-subtotal-missing',
  category: 'revenue',
  severity: 'high',
  dimensions: [
    {
      id: 'subtotal-visible-as-currency',
      description:
        'Whether a subtotal value is visible in the cart summary, formatted as ' +
        'currency.',
      passCriteria:
        'A currency-formatted value (e.g. "$24.99", "$1,234.56") is visible ' +
        'somewhere in the cart summary area, reasonably associated with the ' +
        'order total.',
      failCriteria:
        'No currency-formatted value is visible in the cart summary area.',
    },
  ],
};
