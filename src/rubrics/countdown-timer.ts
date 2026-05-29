import type { Rubric } from './types.js';

/**
 * Targets the `discovery:countdown-timer-broken` false positive from the May 28
 * audit: a timer at 00:00:00 is by-design when the sale has ended. The bug is
 * only real when the page still presents the offer as live while the timer is
 * frozen at zero.
 */
export const countdownTimerRubric: Rubric = {
  id: 'countdown-timer-v1',
  label: 'Countdown timer is working as intended',
  context:
    'A countdown timer is displayed on the page. Sales/offers sometimes end ' +
    'and the timer correctly displays 00:00:00 when the offer is over. The bug ' +
    'is when the timer is frozen at 00:00:00 while the page still presents the ' +
    'offer as active.',
  ruleId: 'rubric:countdown-timer-broken',
  category: 'content',
  severity: 'medium',
  dimensions: [
    {
      id: 'timer-state-matches-offer-state',
      description:
        "Whether the countdown's displayed state matches the offer's " +
        'active/ended state on the page.',
      passCriteria:
        'Either: timer shows a positive countdown AND the page presents an ' +
        'active offer; OR timer shows 00:00:00 AND the page does NOT present an ' +
        'active offer (no "Buy Now" CTA, no "Sale ends in" text, no urgency ' +
        'messaging).',
      failCriteria:
        'Timer shows 00:00:00 while the page still presents the offer as active ' +
        '(urgency messaging, CTAs, "limited time" text).',
    },
  ],
};
