import type { Rubric } from './types.js';
import { countdownTimerRubric } from './countdown-timer.js';
import { cartSubtotalRubric } from './cart-subtotal.js';
import { wrongProductRubric } from './wrong-product.js';

export const RUBRICS: Record<string, Rubric> = {
  'countdown-timer': countdownTimerRubric,
  'cart-subtotal': cartSubtotalRubric,
  'wrong-product': wrongProductRubric,
};

export function getRubric(id: string): Rubric | undefined {
  return RUBRICS[id];
}
