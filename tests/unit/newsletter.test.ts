import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { findNewsletterForm } from '../checks/newsletter.js';

function fakePage(evaluateReturn: unknown): Page {
  return {
    evaluate: async () => evaluateReturn,
  } as unknown as Page;
}

test.describe('findNewsletterForm', () => {
  test('returns form handle when page.evaluate yields a truthy value', async () => {
    const sentinel = { tagName: 'FORM' };
    const result = await findNewsletterForm(fakePage(sentinel));
    expect(result).toBe(sentinel);
  });

  test('returns null when page.evaluate yields null', async () => {
    const result = await findNewsletterForm(fakePage(null));
    expect(result).toBeNull();
  });
});

// Pure-logic regression tests for the validation-signal classifier embedded in
// runNewsletterCheck's page.evaluate. These do not exercise the live module —
// they document the expected detection rules so a future refactor that moves
// this logic into a named helper has a regression net.
test.describe('newsletter validation signal detection (documentation)', () => {
  function classifyValidationSignals(input: {
    validityValid: boolean;
    ariaInvalid: string | null;
    classNames: string[];
    nearbyErrorText: string;
  }): boolean {
    if (!input.validityValid) return true;
    if (input.ariaInvalid === 'true') return true;
    if (input.classNames.some((c) => c === 'error' || c === 'invalid')) return true;
    if (input.nearbyErrorText.trim().length > 0) return true;
    return false;
  }

  test('HTML5 validity.valid=false fires the signal', () => {
    expect(
      classifyValidationSignals({ validityValid: false, ariaInvalid: null, classNames: [], nearbyErrorText: '' }),
    ).toBe(true);
  });

  test('aria-invalid=true fires the signal', () => {
    expect(
      classifyValidationSignals({ validityValid: true, ariaInvalid: 'true', classNames: [], nearbyErrorText: '' }),
    ).toBe(true);
  });

  test('class containing "error" fires the signal', () => {
    expect(
      classifyValidationSignals({ validityValid: true, ariaInvalid: null, classNames: ['error'], nearbyErrorText: '' }),
    ).toBe(true);
  });

  test('visible nearby error message fires the signal', () => {
    expect(
      classifyValidationSignals({
        validityValid: true,
        ariaInvalid: null,
        classNames: [],
        nearbyErrorText: 'Please enter a valid email',
      }),
    ).toBe(true);
  });

  test('no signals → returns false (which would flag a bug)', () => {
    expect(
      classifyValidationSignals({ validityValid: true, ariaInvalid: null, classNames: [], nearbyErrorText: '' }),
    ).toBe(false);
  });
});
