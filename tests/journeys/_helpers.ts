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
