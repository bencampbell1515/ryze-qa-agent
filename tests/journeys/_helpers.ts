/**
 * Shared helpers for the journey / flow tests under tests/journeys/.
 *
 * Two kinds of helpers live here:
 *
 *  1. Pure / DOM-extraction helpers that are unit-tested in _helpers.test.ts
 *     (parsePriceToCents, journeyFingerprint, getCartLineItems,
 *     getCheckoutLineItems). These do NOT hit the network.
 *
 *  2. Live-flow helpers used only by the journey specs (createRunContext,
 *     emitFinding, buildJourneyFinding, addToCart, locale utilities). These
 *     drive a real Page against the live storefront and are exercised by the
 *     journey specs themselves, not by unit tests (per the worktree brief:
 *     "journeys ARE tests, but they're production tests, not unit tests").
 *
 * Line-item extraction is accessibility-tree based (role + accessible name),
 * NOT pixel reading, per the brief. The primary path queries ARIA roles
 * (row / link / spinbutton); a CSS fallback covers non-tabular carts.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import type { CanonicalRecord, Finding, Severity } from '../../src/types/finding.js';

// ───────────────────────────── Line items ─────────────────────────────────

export interface LineItem {
  /** Product name (accessible name of the item's link/heading). */
  name: string;
  /** Quantity as an integer; defaults to 1 when not determinable. */
  quantity: number;
  /** Raw price text as rendered, e.g. "$60.00". */
  linePrice: string;
  /** Price parsed to integer cents, or null if unparseable. */
  linePriceCents: number | null;
}

/**
 * Parse a single price token to integer cents. Handles "$60.00", "$1,234.56",
 * "30 USD", "$30", and treats "Free" as 0. Returns null when there is no price.
 * Assumes US formatting (comma = thousands separator, dot = decimal).
 */
export function parsePriceToCents(text: string): number | null {
  if (!text) return null;
  const trimmed = text.trim();
  // Keep only digits, comma, dot, minus; drop currency symbols/codes/words.
  const numeric = trimmed.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  if (!/\d/.test(numeric)) {
    return /free/i.test(trimmed) ? 0 : null;
  }
  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value)) {
    return /free/i.test(trimmed) ? 0 : null;
  }
  return Math.round(value * 100);
}

/** First price-like substring in a blob of text, or null. */
const PRICE_TOKEN_RE =
  /(\$\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|CAD|EUR|GBP)|£\s?\d[\d,]*(?:\.\d{1,2})?|€\s?\d[\d,]*(?:\.\d{1,2})?|\bFree\b)/i;

function firstPriceToken(text: string): string | null {
  const m = text.match(PRICE_TOKEN_RE);
  return m ? m[0].trim() : null;
}

/**
 * Build a LineItem from a single container locator, or null when the container
 * has no product link (e.g. a table header row). Quantity resolution order:
 * spinbutton value → aria-label="quantity" text → "qty N" regex → 1.
 */
async function lineItemFromContainer(container: import('@playwright/test').Locator): Promise<LineItem | null> {
  // Name: prefer a link, fall back to a heading.
  let name = '';
  const link = container.getByRole('link').first();
  if ((await link.count().catch(() => 0)) > 0) {
    name = ((await link.textContent().catch(() => '')) ?? '').trim();
  }
  if (!name) {
    const heading = container.getByRole('heading').first();
    if ((await heading.count().catch(() => 0)) > 0) {
      name = ((await heading.textContent().catch(() => '')) ?? '').trim();
    }
  }
  if (!name) return null;

  // Quantity.
  let quantity = 1;
  const spin = container.getByRole('spinbutton').first();
  if ((await spin.count().catch(() => 0)) > 0) {
    const v = await spin.inputValue().catch(() => '');
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) quantity = n;
  } else {
    const qtyEl = container.locator('[aria-label*="quantity" i]').first();
    if ((await qtyEl.count().catch(() => 0)) > 0) {
      const qtyText = ((await qtyEl.textContent().catch(() => '')) ?? '').trim();
      const n = Number.parseInt(qtyText.replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(n) && n > 0) quantity = n;
    } else {
      const blob = ((await container.textContent().catch(() => '')) ?? '');
      const m = blob.match(/(?:qty|quantity|×|x)\s*:?\s*(\d+)/i);
      if (m) {
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0) quantity = n;
      }
    }
  }

  // Line price.
  const blob = ((await container.textContent().catch(() => '')) ?? '');
  const priceToken = firstPriceToken(blob);
  return {
    name,
    quantity,
    linePrice: priceToken ?? '',
    linePriceCents: priceToken ? parsePriceToCents(priceToken) : null,
  };
}

/** Core extraction shared by cart + checkout. ARIA rows first, CSS fallback. */
async function extractLineItems(page: Page, fallbackSelectors: string[]): Promise<LineItem[]> {
  const collect = async (locator: import('@playwright/test').Locator): Promise<LineItem[]> => {
    const count = await locator.count().catch(() => 0);
    const out: LineItem[] = [];
    for (let i = 0; i < count; i++) {
      const item = await lineItemFromContainer(locator.nth(i)).catch(() => null);
      if (item) out.push(item);
    }
    return out;
  };

  // Primary: accessibility-tree rows.
  const viaRows = await collect(page.getByRole('row'));
  if (viaRows.length > 0) return viaRows;

  // Fallback: known cart/checkout container selectors.
  for (const sel of fallbackSelectors) {
    const items = await collect(page.locator(sel));
    if (items.length > 0) return items;
  }
  return [];
}

const CART_FALLBACK_SELECTORS = [
  '.cart-item',
  'tr.cart-item',
  '[data-cart-item]',
  'li.cart__item',
  '[role="listitem"]',
];

const CHECKOUT_FALLBACK_SELECTORS = [
  '[data-merchandise]',
  '.order-summary .product',
  '.product',
  '[role="listitem"]',
  'tbody tr',
];

/** Accessibility-tree extraction of cart line items. Returns [] (never throws). */
export async function getCartLineItems(page: Page): Promise<LineItem[]> {
  return extractLineItems(page, CART_FALLBACK_SELECTORS).catch(() => []);
}

/** Accessibility-tree extraction of checkout line items. Returns [] (never throws). */
export async function getCheckoutLineItems(page: Page): Promise<LineItem[]> {
  return extractLineItems(page, CHECKOUT_FALLBACK_SELECTORS).catch(() => []);
}

// ───────────────────────────── Fingerprints ────────────────────────────────

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

/**
 * Stable fingerprint per the check-author guide:
 *   sha1(ruleId + ":" + url + ":" + (role + ":" + name))
 * Uses the accessible name (role+name), not a selector.
 */
export function journeyFingerprint(
  ruleId: string,
  url: string,
  element?: { role?: string; name?: string },
): string {
  const signature = `${element?.role ?? ''}:${element?.name ?? ''}`;
  return sha1(`${ruleId}:${url}:${signature}`);
}

// ───────────────────────────── Run context ─────────────────────────────────

/**
 * A run's findings stream. Mirrors the orchestrate convention of JSONL files
 * under data/ (one JSON object per line). The path is overridable via
 * RYZE_JOURNEY_FINDINGS_PATH so a CI/daemon run can redirect it per-run.
 */
export interface RunContext {
  runId: string;
  findingsPath: string;
  findings: Finding[];
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
}

export function createRunContext(label = 'journey'): RunContext {
  const runId = `journey-${label}-${timestampSlug()}-${Math.random().toString(36).slice(2, 6)}`;
  const findingsPath =
    process.env.RYZE_JOURNEY_FINDINGS_PATH ??
    join(process.cwd(), 'data', 'journey-findings.jsonl');
  return { runId, findingsPath, findings: [] };
}

/** Append a finding to the in-memory list and to the JSONL findings stream. */
export function emitFinding(ctx: RunContext, finding: Finding): void {
  ctx.findings.push(finding);
  try {
    mkdirSync(dirname(ctx.findingsPath), { recursive: true });
    appendFileSync(ctx.findingsPath, JSON.stringify(finding) + '\n');
  } catch {
    // A non-writable findings path must not crash the journey; the in-memory
    // list is still available for assertions.
  }
}

// ──────────────────────────── Finding builder ──────────────────────────────

export interface JourneyFindingInput {
  runId: string;
  ruleId: string;
  severity: Severity;
  url: string;
  title: string;
  description: string;
  element?: { role?: string; name?: string; selector?: string };
  relatedUrls?: string[];
  remediation?: string;
  /** Defaults to 1.0 (journeys are deterministic). */
  confidence?: number;
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * Construct a fully-formed journey Finding with sane defaults: source/category
 * 'journey', deterministic fingerprint, and a pre-confirmed visualGate (journey
 * checks opt out of the gate per docs/check-author-guide.md — there is no
 * single element to gate).
 */
export function buildJourneyFinding(input: JourneyFindingInput): Finding {
  const fingerprint = journeyFingerprint(input.ruleId, input.url, input.element);
  return {
    id: `f-${input.runId}-${fingerprint.slice(0, 10)}`,
    fingerprint,
    runId: input.runId,
    discoveredAt: new Date().toISOString(),
    ruleId: input.ruleId,
    category: 'journey',
    source: 'journey',
    severity: input.severity,
    url: input.url,
    relatedUrls: input.relatedUrls,
    element: input.element,
    title: input.title,
    description: input.description,
    remediation: input.remediation,
    confidence: input.confidence ?? 1.0,
    visualGate: {
      verdict: 'visible',
      reason: 'journey flow finding — no single element to gate',
      judgeModel: 'n/a',
    },
    meta: input.meta,
  };
}

// ──────────────────────────── Add to cart ──────────────────────────────────

export const DEFAULT_WWW_BASE = 'https://www.ryzesuperfoods.com';

/** Matches the ATC button across RYZE's Recharge/Shopify variants. "Get Started"
 *  is the Recharge subscription label and MUST stay (see tests/CLAUDE.md). */
const ATC_NAME_RE = /add to cart|add to bag|subscribe|buy now|get started/i;

export interface AddToCartResult {
  added: boolean;
  /** The product URL as seen BEFORE clicking (navigation may follow the click). */
  productUrl: string;
  /** Human-readable note on how/whether confirmation was detected. */
  detail: string;
}

/**
 * Navigate to a PDP and add the product to the cart. Accounts for the Recharge
 * subscription widget that takes 10–15s to render (per README) by waiting up to
 * 20s for the ATC control. Confirmation is detected via the /cart/add XHR or a
 * cart-UI signal; the call never throws on a missing control — it returns
 * { added: false } so the journey can decide how to report it.
 *
 * Test-data hygiene: this only adds a product to a cart (no checkout submission,
 * no account, no PII). Per the brief's analytics note, an ATC event may reach
 * Klaviyo/Amplitude; flag such runs in the PR.
 */
export async function addToCart(
  page: Page,
  productHandle: string,
  opts: { baseUrl?: string } = {},
): Promise<AddToCartResult> {
  const baseUrl = opts.baseUrl ?? DEFAULT_WWW_BASE;
  const productUrlTarget = productHandle.startsWith('http')
    ? productHandle
    : `${baseUrl}/products/${productHandle.replace(/^\/?(products\/)?/, '')}`;

  await page.goto(productUrlTarget, { waitUntil: 'domcontentloaded' });

  const atc = page.getByRole('button', { name: ATC_NAME_RE }).first();
  try {
    await atc.waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    return { added: false, productUrl: page.url(), detail: 'ATC control never rendered within 20s' };
  }

  // Capture the URL BEFORE clicking — Recharge can redirect on click.
  const productUrl = page.url();

  // Arm the confirmation listeners before the click so we don't miss the XHR.
  const addXhr = page
    .waitForResponse((r) => /\/cart\/(add|change)(\.js)?/.test(r.url()), { timeout: 18_000 })
    .catch(() => null);

  let detail = '';
  await atc.click({ timeout: 15_000 }).catch((e: unknown) => {
    detail = `click failed: ${e instanceof Error ? e.message : String(e)}`;
  });

  const xhr = await addXhr;
  let added = false;
  if (xhr && xhr.status() < 400) {
    added = true;
    detail = `cart/add → HTTP ${xhr.status()}`;
  }
  if (!added) {
    const cartUi = page
      .locator(
        'cart-drawer[open], #cart-notification.active, .cart-count-bubble, #cart-icon-bubble, [data-cart-count]:not([data-cart-count="0"])',
      )
      .first();
    const seen = await cartUi
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (seen) {
      added = true;
      detail = detail || 'cart UI signalled an item was added';
    }
  }

  // Let any drawer settle; never throw if the page closed (CF long-session).
  await page.waitForTimeout(1_000).catch(() => {});

  return { added, productUrl, detail: detail || (added ? 'added' : 'no add confirmation detected') };
}

/**
 * Navigate to /cart resiliently. After addToCart, some themes auto-redirect to
 * /cart; an unconditional goto then races that in-flight navigation and throws
 * "interrupted by another navigation". This settles first, no-ops if already on
 * /cart, and retries once on interruption.
 */
export async function gotoCart(page: Page, baseUrl: string = DEFAULT_WWW_BASE): Promise<void> {
  const cartUrl = `${baseUrl}/cart`;
  const onCart = (): boolean => {
    try {
      return new URL(page.url()).pathname.replace(/\/$/, '') === '/cart';
    } catch {
      return false;
    }
  };
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  if (onCart()) return;
  await page.goto(cartUrl, { waitUntil: 'domcontentloaded' }).catch(async () => {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    if (!onCart()) {
      await page.goto(cartUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
  });
}

/**
 * True when the page is a Shopify checkout: same-origin /checkouts/, the
 * checkout subdomain, shop.app, or a checkout DOM marker. Used to distinguish
 * "reached checkout" from the bot/headless bounce-to-storefront so journeys
 * don't raise false criticals when checkout was never actually reached.
 */
export async function looksLikeCheckout(page: Page): Promise<boolean> {
  try {
    const u = new URL(page.url());
    if (/\/checkouts?(\/|$)/i.test(u.pathname)) return true;
    if (/(^|\.)shopify\.com$/i.test(u.hostname)) return true;
    if (/^checkout\./i.test(u.hostname)) return true;
    if (/(^|\.)shop\.app$/i.test(u.hostname)) return true;
  } catch {
    /* fall through to DOM check */
  }
  // DOM fallback uses ONLY unambiguous checkout markers. Generic attributes
  // like [data-step] or .section--shipping-address appear on storefront
  // sliders/sections too and caused false "reached checkout" positives.
  const marker = page
    .locator('#checkout-main, form[data-payment-form], #checkout_payment_gateway, main[data-checkout]')
    .first();
  return (await marker.count().catch(() => 0)) > 0;
}

/**
 * Best-effort wait for cart line items to render. The RYZE /cart is JS-rendered
 * (items appear a beat after domcontentloaded); extracting too early returns an
 * empty list. Waits for a quantity input / cart-item / product link, capped.
 */
export async function waitForCartItems(page: Page, timeoutMs = 8_000): Promise<void> {
  await page
    .locator('input[type="number"], input[name*="quantity" i], .cart-item, [data-cart-item], a[href*="/products/"]')
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .catch(() => {});
}

// ──────────────────────────── Locale utilities ─────────────────────────────

/** Load the canonical record (brand facts, locale prefixes) from config. */
export function loadCanonicalRecord(): CanonicalRecord {
  const path = join(process.cwd(), 'config', 'canonical-record.json');
  return JSON.parse(readFileSync(path, 'utf8')) as CanonicalRecord;
}

/** The `<html lang>` attribute value, lowercased, or null. */
export async function getHtmlLang(page: Page): Promise<string | null> {
  const lang = await page.locator('html').getAttribute('lang').catch(() => null);
  return lang ? lang.toLowerCase() : null;
}
