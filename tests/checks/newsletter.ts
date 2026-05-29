import type { Page } from '@playwright/test';
import type { BugCollector } from '../fixtures/bug-collector.js';
import type { Viewport } from '../../src/types.js';
import { emitBug, type DualWriteContext } from './_emit.js';

/**
 * Attempts to find a newsletter signup form on the page.
 *
 * Returns the first form element that:
 * 1. Contains an input[type="email"]
 * 2. Is not a search form (no input[type="search"])
 * 3. Is not a checkout/account form (no action containing /cart/add or /account/login)
 *
 * Returns null if no suitable form is found.
 */
export async function findNewsletterForm(page: Page): Promise<HTMLFormElement | null> {
  return page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form'));
    for (const form of forms) {
      const hasEmailInput = form.querySelector('input[type="email"]');
      const hasSearchInput = form.querySelector('input[type="search"]');
      const action = form.getAttribute('action') || '';

      // Skip search forms
      if (hasSearchInput) continue;

      // Skip checkout/account forms
      if (action.includes('/cart/add') || action.includes('/account/login')) continue;

      // This looks like a newsletter form
      if (hasEmailInput) return form as HTMLFormElement;
    }
    return null;
  });
}

/**
 * Tests email validation on a newsletter signup form.
 *
 * This check ONLY runs once per audit run, not on every URL.
 * The caller is responsible for calling this check only once.
 *
 * Logic:
 * 1. Find newsletter form (via findNewsletterForm)
 * 2. If no form found, skip silently
 * 3. Type invalid email "not-an-email" into email input
 * 4. Blur the input
 * 5. Wait 500ms for validation to settle
 * 6. Check for validation signals:
 *    - input.validity.valid === false
 *    - input has aria-invalid="true"
 *    - input or parent has error/invalid class
 *    - Visible error text near the input
 * 7. If no validation signals found, flag content:newsletter-no-validation
 */
export async function runNewsletterCheck(
  page: Page,
  bugs: BugCollector,
  viewport: Viewport,
  ctx?: DualWriteContext,
): Promise<void> {
  try {
    const form = await findNewsletterForm(page);
    if (!form) {
      // No newsletter form found on this page; skip silently
      return;
    }

    const url = page.url();

    // Get the email input and type invalid email
    const emailInput = await page.locator('form input[type="email"]').first();
    if (!emailInput) {
      // Form was found but email input is not accessible; skip
      return;
    }

    // Type invalid email
    await emailInput.fill('not-an-email');

    // Blur to trigger validation
    await emailInput.blur();

    // Wait for validation to settle
    await page.waitForTimeout(500).catch(() => {});

    // Check for validation signals
    const hasValidationSignals = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="email"]'));
      for (const input of inputs) {
        const htmlInput = input as HTMLInputElement;

        // Check 1: HTML5 validity API
        if (!htmlInput.validity.valid) return true;

        // Check 2: aria-invalid attribute
        if (htmlInput.getAttribute('aria-invalid') === 'true') return true;

        // Check 3: error/invalid class on input or parent
        if (htmlInput.classList.contains('error') || htmlInput.classList.contains('invalid')) {
          return true;
        }
        const parent = htmlInput.parentElement;
        if (parent?.classList.contains('error') || parent?.classList.contains('invalid')) {
          return true;
        }

        // Check 4: Visible error text near the input
        const errorElements = [
          htmlInput.nextElementSibling,
          parent?.querySelector('[role="alert"]'),
          parent?.querySelector('.error-message'),
          parent?.querySelector('.error'),
        ].filter(Boolean) as Element[];

        for (const el of errorElements) {
          const text = el.textContent || '';
          const style = window.getComputedStyle(el);
          const isVisible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            text.trim().length > 0;
          if (isVisible) return true;
        }
      }
      return false;
    });

    if (!hasValidationSignals) {
      emitBug(bugs, ctx, {
        ruleId: 'content:newsletter-no-validation',
        severity: 'medium',
        bugClass: 'content',
        message:
          'Newsletter email input does not show validation feedback when invalid email is entered',
        url,
        viewport,
      }, { title: 'Newsletter form lacks email validation feedback' });
    }
  } catch (err) {
    // If newsletter navigation/interaction throws unexpectedly, skip quietly
    // (network error, page closed mid-run, etc.)
  }
}
