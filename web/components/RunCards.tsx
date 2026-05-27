"use client";

import type { Run } from "@/lib/schema";
import { duration, fullTime, relativeTime } from "@/lib/format";
import { Numeral } from "./Numeral";

const STATUS_HEADLINE: Record<string, string> = {
  complete:           "Audit complete.",
  running:            "Audit in progress.",
  requested:          "Standing by.",
  failed:             "Audit failed.",
  cancelled:          "Audit cancelled.",
  "cancel-requested": "Halting audit.",
};

const STATUS_BAND_COLOR: Record<string, string> = {
  complete:           "var(--color-teal)",
  running:            "var(--color-amber)",
  requested:          "var(--color-amber)",
  failed:             "var(--color-coral)",
  cancelled:          "var(--color-lavender)",
  "cancel-requested": "var(--color-lavender)",
};

function shortId(id: string): string {
  return `SC-${id.slice(0, 6).toUpperCase()}`;
}

export function RunCards({ runs, onSelect }: { runs: Run[]; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-4">
      {runs.map((r, i) => (
        <RunCard key={r.id} run={r} onSelect={onSelect} index={i} />
      ))}
    </div>
  );
}

function RunCard({ run, onSelect, index }: { run: Run; onSelect: (id: string) => void; index: number }) {
  const isActive = run.status === "running" || run.status === "requested" || run.status === "cancel-requested";
  const headline = STATUS_HEADLINE[run.status] ?? run.status;
  const bandColor = STATUS_BAND_COLOR[run.status] ?? "var(--color-ink-3)";
  return (
    <article
      onClick={() => onSelect(run.id)}
      role="button"
      tabIndex={0}
      className={`group relative grid grid-cols-[6px_1fr_auto] cursor-pointer border border-[var(--color-rule)] bg-[var(--color-base-1)] transition hover:bg-[var(--color-base-2)] ${isActive ? "scanline" : ""}`}
      style={{ animationDelay: `${0.05 * index}s` }}
    >
      {/* Status band */}
      <div className="h-full" style={{ background: bandColor }} aria-hidden />

      {/* Main */}
      <div className="px-7 py-7">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-ink-3)]">
            {shortId(run.id)}
          </span>
          <span className="h-px w-6 bg-[var(--color-rule)]" />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.2em]" style={{ color: bandColor }}>
            {run.status}
          </span>
        </div>
        <h2 className="mt-3 font-display text-[42px] leading-[0.95] italic text-[var(--color-ink-1)]">
          {headline}
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-[11px] text-[var(--color-ink-3)]">
          <span title={fullTime(run.requestedAt)}>
            {relativeTime(run.requestedAt)}
          </span>
          <span>· {run.requestedBy.split("@")[0]}</span>
          {run.startedAt && <span>· {duration(run.startedAt, run.completedAt)}</span>}
          {typeof run.urlCount === "number" && <span>· {run.urlCount} URLs</span>}
        </div>
        {run.errorMessage && (
          <div className="mt-4 max-w-xl font-mono text-[11px] leading-relaxed text-[var(--color-coral)]/90">
            <span className="text-[var(--color-coral)]/60">err ▸ </span>
            {run.errorMessage}
          </div>
        )}
      </div>

      {/* Bug count + CTA */}
      <div className="flex flex-col items-end justify-between px-7 py-7 text-right">
        <div>
          {typeof run.bugCount === "number" ? (
            <Numeral
              value={run.bugCount}
              size="xl"
              tone={run.bugCount > 0 ? "amber" : "muted"}
            />
          ) : (
            <span className="font-mono text-[14px] tabular-nums text-[var(--color-ink-4)]">—</span>
          )}
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-3)]">
            {typeof run.bugCount === "number" ? "bugs" : "pending"}
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-3)] transition group-hover:text-[var(--color-amber)]">
          Open ▸
        </span>
      </div>
    </article>
  );
}
