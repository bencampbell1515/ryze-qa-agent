"use client";

import { useMemo, useState } from "react";
import type { Finding, FindingSeverity } from "@/lib/schema";
import { FindingCard } from "./FindingCard";

const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low"];

function severityRank(s: FindingSeverity): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/** A filterable list of findings. Filters are local state (severity / category
 *  / source multi-select); empty selection means "all". URL-sync is a future
 *  enhancement per the brief. */
export function FindingsList({
  findings,
  cropsPrefix,
}: {
  findings: Finding[];
  cropsPrefix?: string;
}) {
  const [sevFilter, setSevFilter] = useState<Set<string>>(new Set());
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set());
  const [srcFilter, setSrcFilter] = useState<Set<string>>(new Set());

  const { severities, categories, sources } = useMemo(() => {
    const sev = new Set<string>();
    const cat = new Set<string>();
    const src = new Set<string>();
    for (const f of findings) {
      sev.add(f.severity);
      cat.add(f.category);
      src.add(f.source);
    }
    return {
      severities: [...sev].sort(
        (a, b) => severityRank(a as FindingSeverity) - severityRank(b as FindingSeverity),
      ),
      categories: [...cat].sort(),
      sources: [...src].sort(),
    };
  }, [findings]);

  const filtered = useMemo(() => {
    const out = findings.filter(
      (f) =>
        (sevFilter.size === 0 || sevFilter.has(f.severity)) &&
        (catFilter.size === 0 || catFilter.has(f.category)) &&
        (srcFilter.size === 0 || srcFilter.has(f.source)),
    );
    // Stable, useful default order: severity desc, then confidence desc.
    return out.sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        b.confidence - a.confidence,
    );
  }, [findings, sevFilter, catFilter, srcFilter]);

  if (findings.length === 0) {
    return (
      <p className="border border-dashed border-[var(--color-rule)] bg-[var(--color-base-1)]/40 px-5 py-8 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
        No findings in this tier.
      </p>
    );
  }

  return (
    <div>
      {/* Filters */}
      <div className="space-y-3 border border-[var(--color-rule)] bg-[var(--color-base-1)]/40 p-4">
        <FilterRow label="Severity" options={severities} selected={sevFilter} onToggle={setSevFilter} />
        <FilterRow label="Category" options={categories} selected={catFilter} onToggle={setCatFilter} />
        <FilterRow label="Source" options={sources} selected={srcFilter} onToggle={setSrcFilter} />
      </div>

      {/* Count line */}
      <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
        {filtered.length === findings.length
          ? `${findings.length} findings`
          : `${filtered.length} of ${findings.length} findings`}
      </p>

      {/* Cards */}
      <div className="mt-3 space-y-3">
        {filtered.map((f) => (
          <FindingCard key={f.id} finding={f} cropsPrefix={cropsPrefix} />
        ))}
        {filtered.length === 0 && (
          <p className="px-5 py-6 text-center font-mono text-[11px] text-[var(--color-ink-3)]">
            No findings match the active filters.
          </p>
        )}
      </div>
    </div>
  );
}

function FilterRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (next: Set<string>) => void;
}) {
  if (options.length <= 1) return null;
  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onToggle(next);
  };
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
        {label}
      </span>
      {options.map((opt) => {
        const active = selected.has(opt);
        return (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] transition ${
              active
                ? "border-[var(--color-amber)] bg-[var(--color-amber)]/15 text-[var(--color-amber)]"
                : "border-[var(--color-rule)] text-[var(--color-ink-3)] hover:text-[var(--color-ink-1)]"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
