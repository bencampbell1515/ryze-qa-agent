"use client";

import type { HygieneFinding, HygieneReason } from "@/lib/schema";

const REASON_LABEL: Record<HygieneReason, string> = {
  "deny-list-match": "Matched deny pattern",
  "shopify-draft": "Shopify status: draft",
  "shopify-archived": "Shopify status: archived",
  "shopify-not-found": "Shopify: not found",
  "shopify-unlisted": "Shopify: unlisted",
  "duplicate-handle": "Duplicate handle",
  "stale-replo": "Stale Replo block",
};

function reasonLabel(reason: string): string {
  return REASON_LABEL[reason as HygieneReason] ?? reason;
}

/** Compact reference row for a hygiene exclusion. Not a bug — system-health
 *  context for ongoing cleanup, so it stays terse (no card chrome, no crop). */
export function HygieneEntry({ entry }: { entry: HygieneFinding }) {
  const detailPairs = entry.detail ? Object.entries(entry.detail) : [];
  return (
    <li className="grid grid-cols-1 gap-1 border-b border-[var(--color-rule)] bg-[var(--color-base-1)] px-5 py-3 last:border-b-0 md:grid-cols-[1fr_auto] md:items-baseline md:gap-4">
      <span
        className="truncate font-mono text-[11.5px] text-[var(--color-ink-1)]"
        title={entry.url}
      >
        {entry.url}
      </span>
      <span className="flex flex-wrap items-baseline gap-2 md:justify-end">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-lavender)]">
          {reasonLabel(entry.reason)}
        </span>
        {detailPairs.length > 0 && (
          <span className="font-mono text-[10.5px] text-[var(--color-ink-3)]">
            {detailPairs.map(([k, v]) => `${k}: ${v}`).join(" · ")}
          </span>
        )}
      </span>
    </li>
  );
}
