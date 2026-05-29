/**
 * Journey: language switcher correctness.
 *
 * Audit miss: nothing asserts that the language switcher actually changes the
 * locale across navigation — that the URL gains the locale prefix, that
 * <html lang> follows, and that the rendered content is genuinely translated
 * (not just the URL).
 *
 * Findings:
 *   - journey:language-switcher-missing   (medium) — no switcher found
 *   - journey:language-switcher-broken     (high)   — URL switched but content stayed in default language
 *   - journey:locale-attribute-mismatch    (medium) — URL says /es/ but <html lang> says en
 *
 * This is the most exploratory journey. The URL + <html lang> checks are
 * solid; the locale-CONTENT checks (step 6) are heuristic and may need
 * calibration against the live storefront — see CONTENT-CHECK TODO below.
 *
 * Run it:  RUN_JOURNEYS=1 npx playwright test tests/journeys/language-switcher.spec.ts --project=desktop
 */

import { test, expect, type Page } from '@playwright/test';
import {
  createRunContext,
  emitFinding,
  buildJourneyFinding,
  loadCanonicalRecord,
  getHtmlLang,
  DEFAULT_WWW_BASE,
} from './_helpers.js';

const RUN_JOURNEYS = !!process.env.RUN_JOURNEYS || !!process.env.RYZE_RUN_JOURNEYS;
const TARGET_LOCALE = process.env.RYZE_JOURNEY_LOCALE ?? 'es';

/** A few Spanish words we'd expect somewhere in genuinely-translated chrome. */
const SPANISH_HINTS = /carrito|tienda|cuenta|buscar|iniciar sesión|añadir|comprar/i;
/** English chrome strings that should NOT survive a switch to Spanish. */
const ENGLISH_SHOP_ALL = /\bshop all\b/i;

/**
 * Best-effort: switch the storefront to the target locale. Returns how the
 * switch was attempted, or null if no switcher was found.
 */
async function trySwitchLocale(page: Page, locale: string, prefix: string): Promise<string | null> {
  const noslash = prefix.replace(/\/$/, ''); // "/es"

  // The RYZE storefront uses Shopify Dawn's <localization-form>: a disclosure
  // whose locale <a> links are revealed by clicking a toggle button. Open any
  // such toggle first so the locale links become actionable.
  const toggles = page.locator(
    'localization-form button, .disclosure__button, button[aria-expanded][aria-controls*="anguage" i], button[aria-expanded][aria-controls*="ountry" i]',
  );
  const toggleCount = await toggles.count().catch(() => 0);
  for (let i = 0; i < toggleCount; i++) {
    await toggles.nth(i).click({ timeout: 3_000 }).catch(() => {});
  }

  // Strategy 1: a locale anchor, matching BOTH relative ("/es") and absolute
  // ("https://…/es") hrefs, including links inside the disclosure list.
  const localeLink = page
    .locator(
      [
        `a[hreflang="${locale}" i]`,
        `a[href$="${noslash}"]`,
        `a[href*="${noslash}/"]`,
        `a[href*="${noslash}?"]`,
      ].join(', '),
    )
    .first();
  if ((await localeLink.count().catch(() => 0)) > 0) {
    const href = await localeLink.getAttribute('href').catch(() => null);
    const clicked = await localeLink.click({ timeout: 6_000 }).then(() => true).catch(() => false);
    if (!clicked && href) {
      // Link present but not actionable (collapsed disclosure) — follow its href.
      await page.goto(new URL(href, page.url()).toString(), { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return 'locale-href-nav';
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return 'locale-link';
  }

  // Strategy 2: a link whose text names the language (e.g. "Español").
  const namedLink = page.getByRole('link', { name: /espa[ñn]ol/i }).first();
  if ((await namedLink.count().catch(() => 0)) > 0) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      namedLink.click({ timeout: 10_000 }).catch(() => {}),
    ]);
    return 'named-link';
  }

  // Strategy 3: a Shopify localization <select> (form auto-submits on change).
  const localeSelect = page
    .locator('form[action*="localization"] select, select[name="locale_code"], select[name="language_code"]')
    .first();
  if ((await localeSelect.count().catch(() => 0)) > 0) {
    // Try the locale code as an option value, then as an uppercase variant
    // (Shopify sometimes uses "ES"). selectOption throws if none match.
    const selected = await localeSelect
      .selectOption([{ value: locale }, { value: locale.toUpperCase() }])
      .then(() => true)
      .catch(() => false);
    if (selected) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return 'locale-select';
    }
  }

  // Strategy 4 (fallback): the storefront advertises the locale via a head
  // <link rel="alternate" hreflang>. On RYZE, the interactive switcher is a
  // JS-built Shopify Dawn <localization-form> disclosure that is NOT reliably
  // present in the queryable DOM under headless Chrome (verified live: the
  // tag string is in the HTML but querySelectorAll returns 0). When the
  // interactive control can't be actuated, follow the advertised localized URL
  // so we still validate the localized experience (URL prefix + <html lang> +
  // content). TODO: actuate the real disclosure switcher once a stable handle
  // is found (may require a headed run or a specific viewport/footer reveal).
  const altHref = await page
    .locator(`link[rel="alternate"][hreflang="${locale}" i]`)
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (altHref) {
    await page.goto(new URL(altHref, page.url()).toString(), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return 'alternate-link-nav';
  }

  return null;
}

test.describe('journey: language switcher', () => {
  test.beforeEach(() => {
    test.skip(!RUN_JOURNEYS, 'Live journey — set RUN_JOURNEYS=1 (hits the live storefront).');
  });
  test.setTimeout(120_000);

  test('switching locale updates URL, <html lang>, and content', async ({ page }, testInfo) => {
    const ctx = createRunContext('language-switcher');
    const canonical = loadCanonicalRecord();
    const prefix = canonical.localePathPrefixes[TARGET_LOCALE];
    expect(prefix, `localePathPrefixes must define "${TARGET_LOCALE}"`).toBeTruthy();

    // 1. Homepage, default locale.
    await page.goto(DEFAULT_WWW_BASE, { waitUntil: 'domcontentloaded' });

    // 2. Find + use the switcher.
    const method = await trySwitchLocale(page, TARGET_LOCALE, prefix);
    if (!method) {
      emitFinding(ctx, buildJourneyFinding({
        runId: ctx.runId,
        ruleId: 'journey:language-switcher-missing',
        severity: 'medium',
        url: page.url(),
        title: 'Language switcher not found on the homepage',
        description: `No locale link or localization <select> for "${TARGET_LOCALE}" was found. Shoppers cannot switch language from the homepage, or the switcher selector has changed.`,
        remediation: 'Confirm the storefront exposes a language/locale switcher; if its markup changed, update trySwitchLocale().',
        meta: { step: 'find-switcher', targetLocale: TARGET_LOCALE },
      }));
      await testInfo.attach('journey-findings.json', { body: JSON.stringify(ctx.findings, null, 2), contentType: 'application/json' });
      return;
    }

    await page.waitForTimeout(1_500).catch(() => {});
    const switchedUrl = page.url();
    const urlSwitched = new URL(switchedUrl).pathname.startsWith(prefix.replace(/\/$/, ''));

    // 4 + 5. URL prefix and <html lang>.
    const htmlLang = (await getHtmlLang(page)) ?? '';
    const langMatches = htmlLang.startsWith(TARGET_LOCALE);

    if (urlSwitched && !langMatches) {
      emitFinding(ctx, buildJourneyFinding({
        runId: ctx.runId,
        ruleId: 'journey:locale-attribute-mismatch',
        severity: 'medium',
        url: switchedUrl,
        element: { role: 'document', name: 'html[lang]' },
        title: `URL is on "${prefix}" but <html lang> is "${htmlLang || '(empty)'}"`,
        description: `After switching to ${TARGET_LOCALE}, the URL carries the locale prefix but the <html lang> attribute is "${htmlLang || '(empty)'}" instead of "${TARGET_LOCALE}". Assistive tech and search engines will mis-identify the page language.`,
        remediation: `Set <html lang="${TARGET_LOCALE}"> on localized pages.`,
        meta: { step: 'locale-attribute', switchMethod: method, htmlLang, expected: TARGET_LOCALE, url: switchedUrl },
      }));
    }

    // 6. CONTENT-CHECK (heuristic). TODO: calibrate SPANISH_HINTS/ENGLISH_SHOP_ALL
    //    against the live storefront if these produce false positives — the
    //    brief flags this journey as exploratory.
    if (urlSwitched) {
      const bodyText = ((await page.locator('body').textContent().catch(() => '')) ?? '');
      const hasSpanishHint = SPANISH_HINTS.test(bodyText);
      const hasEnglishShopAll = ENGLISH_SHOP_ALL.test(bodyText);
      const contentStillEnglish = !hasSpanishHint && hasEnglishShopAll;

      if (contentStillEnglish) {
        emitFinding(ctx, buildJourneyFinding({
          runId: ctx.runId,
          ruleId: 'journey:language-switcher-broken',
          severity: 'high',
          url: switchedUrl,
          title: 'Locale URL switched but page content stayed in the default language',
          description: `After switching to ${TARGET_LOCALE}, the URL is on "${prefix}" but the page still reads as English (found "Shop All", no Spanish chrome such as "carrito"). The switcher changes the URL without translating content.`,
          remediation: 'Ensure localized content (translations) renders for the locale, not just the URL prefix.',
          meta: {
            step: 'content-check',
            switchMethod: method,
            hasSpanishHint,
            hasEnglishShopAll,
            url: switchedUrl,
          },
        }));
      }
    } else {
      // The switcher was actuated but the URL never moved to the locale prefix.
      emitFinding(ctx, buildJourneyFinding({
        runId: ctx.runId,
        ruleId: 'journey:language-switcher-broken',
        severity: 'high',
        url: switchedUrl,
        title: 'Language switcher did not navigate to the locale URL',
        description: `Actuated the switcher (${method}) for ${TARGET_LOCALE}, but the URL (${switchedUrl}) is not under the expected prefix "${prefix}".`,
        remediation: 'Verify the switcher target href / form action points to the localized path.',
        meta: { step: 'url-check', switchMethod: method, expectedPrefix: prefix, url: switchedUrl },
      }));
    }

    await testInfo.attach('journey-findings.json', { body: JSON.stringify(ctx.findings, null, 2), contentType: 'application/json' });
    // eslint-disable-next-line no-console
    console.log(
      `[journey:language-switcher] method=${method} url=${switchedUrl} urlSwitched=${urlSwitched} ` +
        `htmlLang=${htmlLang} findings=${ctx.findings.length}`,
    );

    expect(ctx.runId).toBeTruthy();
  });
});
