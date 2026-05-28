# Worktree E: Journey / Flow Tests

## Mission

Add scripted Playwright journeys for revenue-critical multi-step flows.
Each journey navigates a real path through the site and asserts in-flow
conditions that page-isolated checks cannot see, including link integrity
on contextual variants extracted at each step.

## Why

Audit misses surfaced this entire class:
- The privacy-policy link inside the checkout disclaimer 404s in context.
  Page-at-a-time auditing visits `/policies/privacy-policy` directly and
  finds it loads fine; the broken contextual variant only appears in the
  checkout-rendered DOM.
- Cart-to-checkout state continuity (does the cart item appear in
  checkout?) is not currently asserted.
- Language switcher correctness across navigation is not asserted.

Journey tests model these as explicit flows.

## Files to create

### `tests/journeys/` directory

Three Playwright tests to start:

```
tests/journeys/checkout-disclaimer-links.spec.ts
tests/journeys/cart-to-checkout-continuity.spec.ts
tests/journeys/language-switcher.spec.ts
```

### `tests/journeys/checkout-disclaimer-links.spec.ts`

Flow:
1. Visit a representative PDP (configurable; default
   `/products/ryze-mushroom-coffee`).
2. Click "Add to cart" / equivalent. Wait for confirmation.
3. Navigate to `/cart`.
4. Click checkout button. Wait for checkout to load (Shopify checkout is
   on a different subdomain; allow cross-origin navigation).
5. Locate the disclaimer / terms paragraph at the checkout (the area
   containing the "by completing this order, you agree to..." text).
6. Use `checkLinksInContainer` from `src/cross-page/links-journey-helper.ts`
   (delivered by worktree B) to extract all links in that container and
   validate them.
7. Emit Findings into the run's findings stream.

Assertions:
- Disclaimer container is found (if not, emit `journey:disclaimer-missing`
  as `critical` since it implies the legal disclaimer disappeared).
- Every link in the disclaimer returns 200 (worktree B's helper handles
  this; this journey just configures the call).

### `tests/journeys/cart-to-checkout-continuity.spec.ts`

Flow:
1. Visit a representative PDP.
2. Add to cart.
3. Navigate to `/cart`. Capture the line items (product names, quantities,
   prices) using accessibility-tree queries (NOT pixel-based reading).
4. Proceed to checkout.
5. Capture the line items in checkout.
6. Assert: every cart item is present in checkout with the same quantity
   and the same line price.

Findings on mismatch:
- `journey:cart-checkout-item-mismatch` (critical) if an item is missing
  or quantity differs
- `journey:cart-checkout-price-mismatch` (high) if quantity matches but
  line price differs

### `tests/journeys/language-switcher.spec.ts`

Flow:
1. Visit the homepage in default locale.
2. Find the language switcher (best-effort selector; if not present,
   emit `journey:language-switcher-missing` as `medium` and end).
3. Switch to Spanish (or another locale supported by the switcher).
4. Verify the URL now contains the Spanish path prefix from
   `canonical.localePathPrefixes`.
5. Verify the page's `<html lang>` attribute matches.
6. Run a sample of expected-Spanish text checks: the cart link should say
   "carrito" or similar, the nav items should NOT say "Shop All" in English.

Findings:
- `journey:language-switcher-broken` (high) if URL switches but content
  stays in default language
- `journey:locale-attribute-mismatch` (medium) if URL says `/es/` but
  `<html lang>` says `en`

This journey is the most exploratory. If the storefront's language
switcher behavior is unclear, ship the journey with just the URL + `<html
lang>` checks and document the locale-content checks as TODO.

## Common patterns

All journeys share a small helpers file:

### `tests/journeys/_helpers.ts`

- `createRunContext()` — produces a `runId` and a place to append findings,
  matching the orchestrate convention.
- `emitFinding(finding)` — appends to the journeys finding stream.
- `addToCart(page, productHandle)` — encapsulates the add-to-cart click +
  wait. PDPs use Recharge subscription widgets that take 10-15s to render;
  the helper must wait reliably.
- `getCartLineItems(page)` — accessibility-tree-based extraction of cart
  items.
- `getCheckoutLineItems(page)` — same for the checkout step.

## Tests of journeys

Journeys ARE tests, but they're production tests, not unit tests. Add unit
tests for the helpers:

`tests/journeys/_helpers.test.ts`:
- mocked Page with cart HTML → `getCartLineItems` returns the right shape
- mocked Page without expected selectors → `getCartLineItems` returns
  empty array (no throw)

The journeys themselves run via the existing `npm run test:audit` or
similar; document the right invocation in the PR.

## Severity guidance

Journey findings should be high or critical for revenue-impacting failures
(checkout disclaimer 404, cart/checkout mismatch) and medium for ergonomic
ones (language switcher cosmetic issues). This matches the severity floors
table in `docs/check-author-guide.md`.

## Success criteria

- The three journey files exist and run without errors against the live
  site (some may produce findings, that's expected).
- Helpers have unit tests and they pass.
- Running the checkout-disclaimer journey against ryzesuperfoods.com
  produces a finding if the broken privacy-policy link is still present.
- No changes outside `tests/journeys/`, `tests/fixtures/journeys/` (if
  fixtures needed).

## Reference

- `src/types/finding.ts`
- `src/cross-page/links-journey-helper.ts` (delivered by worktree B; if
  not yet on main, stub it locally and document the dependency)
- `docs/check-author-guide.md`
- README for Playwright config patterns
- Repo gotcha: Recharge ATC button takes 10-15s to render (per README).
  Account for this in `addToCart`.

## Boundaries — do not

- Modify check modules under `src/checks/`
- Modify orchestrate
- Submit payment, create accounts, or visit `/admin` / `/account/login`
  (per the repo's existing "do not" list)
- Use real personal info in any form. Test data only.
- Add cart items that would impact inventory or analytics in a way that
  matters. If the storefront tracks ATC events into Klaviyo or Amplitude,
  use a test product or a recognizable test-user signature in any form
  fields.

## PR convention

Title: `worktree-E: journey tests for checkout, cart continuity, language switcher`

Description must list:
- Files added
- Helpers added
- Whether worktree B's `links-journey-helper.ts` is already on main; if
  stubbed, mark TODO
- Dry-run results on the live site
- Any analytics concerns (did the journeys generate test events into
  Amplitude / Klaviyo? Mark them in PR so they can be filtered)

## Open assumptions to verify

1. Playwright config supports cross-origin (Shopify checkout is on
   `checkout.shopify.com`). Confirm.
2. There's a test-user pattern (e.g. `qa+<runId>@ryzesuperfoods.com`) for
   any email field in checkout. If not, propose one.
3. Whether journeys run on every audit or only nightly. Document the
   intended cadence.
