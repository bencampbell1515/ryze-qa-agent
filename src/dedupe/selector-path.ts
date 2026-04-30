/**
 * Walk up from an element to the nearest Shopify section ancestor.
 * Returns a stable anchor string like `div[data-section-type=featured-product]`
 * or "document" if no anchor found.
 *
 * Designed to be serialized and injected via page.evaluate().
 */
export function getSectionAnchor(selector: string): string {
  const el = document.querySelector(selector);
  if (!el) return 'document';

  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const dt = node.getAttribute('data-section-type');
    if (dt) return `${node.tagName.toLowerCase()}[data-section-type=${dt}]`;

    const id = node.id;
    if (id?.startsWith('shopify-section-')) {
      // strip numeric suffix from id, keep the type part
      const type = id.replace(/^shopify-section-/, '').replace(/-\d+$/, '');
      return `${node.tagName.toLowerCase()}[id^=shopify-section-][type=${type}]`;
    }

    const cls = Array.from(node.classList).find((c) =>
      /^(section|sec)-/.test(c),
    );
    if (cls) return `${node.tagName.toLowerCase()}[class^=${cls}]`;

    node = node.parentElement;
  }
  return 'document';
}

/**
 * Build a full CSS selector path from the element to its section anchor.
 */
export function getSelectorPath(selector: string): string {
  const el = document.querySelector(selector);
  if (!el) return selector;

  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node !== document.documentElement && depth < 8) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : '';
    const cls = node.classList.length
      ? `.${Array.from(node.classList)
          .slice(0, 2)
          .join('.')}`
      : '';
    parts.unshift(`${tag}${id || cls}`);
    node = node.parentElement;
    depth++;
  }
  return parts.join(' > ');
}
