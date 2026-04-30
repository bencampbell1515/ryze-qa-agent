---
description: How to discover URLs from ryzesuperfoods.com sitemaps
---

## Crawl Strategy

1. Fetch `https://www.ryzesuperfoods.com/sitemap.xml` and `https://shop.ryzesuperfoods.com/sitemap.xml`.
2. Parse with `fast-xml-parser`. Follow `<sitemap>` child entries (Shopify splits into `sitemap_products_*.xml`, `sitemap_collections_*.xml`, etc.).
3. Categorize each URL:
   - `home` — exactly `/` or root
   - `product` — matches `/products/*`
   - `collection` — matches `/collections/*`
   - `page` — matches `/pages/*`
   - `blog` — matches `/blogs/*/*`
   - `cart` — `/cart`
   - `policy` — `/policies/*`
4. Sample limits: all home/cart/policy/page/collection/product; cap blogs at 20 most recent.
5. Check `robots.txt` via `robots-parser` before adding any URL.
6. Write result to `output/url-list.json` as `{ home[], product[], collection[], page[], blog[], cart[], policy[] }`.
