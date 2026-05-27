"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useRuns } from "@/lib/runs";
import { useDiffRequest } from "@/lib/diff";
import { relativeTime } from "@/lib/format";
import type { BugSummary, Run, SemanticPair } from "@/lib/schema";
import { Numeral } from "./Numeral";
import { Diode } from "./Diode";

function shortId(id: string): string {
  return `SC-${id.slice(0, 6).toUpperCase()}`;
}

export function DiffView() {
  const { user } = useAuth();
  const { runs } = useRuns(50);
  const completed = useMemo(
    () => runs.filter((r) => r.status === "complete" && !!r.bugsJsonPath),
    [runs],
  );
  const [idA, setIdA] = useState<string | null>(null);
  const [idB, setIdB] = useState<string | null>(null);

  // auto-pick two newest
  useEffect(() => {
    if (completed.length >= 2 && !idA && !idB) {
      setIdA(completed[1].id);
      setIdB(completed[0].id);
    }
  }, [completed, idA, idB]);

  const { diff, ensuring, error } = useDiffRequest(idA, idB, user?.email ?? null);

  // Apply semantic matches: move matched bugs out of onlyA / onlyB
  const computed = useMemo(() => {
    if (!diff?.exactOnlyA || !diff?.exactOnlyB || !diff?.exactBoth) return null;
    const semantic = diff.semanticPairs ?? [];
    const semanticKeysA = new Set(semantic.map((p) => p.keyA));
    const semanticKeysB = new Set(semantic.map((p) => p.keyB));
    const onlyA = diff.exactOnlyA.filter((b) => !semanticKeysA.has(b.key));
    const onlyB = diff.exactOnlyB.filter((b) => !semanticKeysB.has(b.key));
    return {
      onlyA,
      onlyB,
      exactRecurring: diff.exactBoth,
      semanticRecurring: semantic,
      totalRecurring: diff.exactBoth.length + semantic.length,
    };
  }, [diff]);

  return (
    <div className="dot-grid min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto max-w-[1280px] px-6 pb-24 pt-12">
        <SectionLabel index="01" title="Comparison" />

        <div className="mt-6 border-b border-[var(--color-rule)] pb-10 rise-in">
          <h1 className="font-display text-[88px] leading-[0.85] italic tracking-[-0.02em]">
            Diff<span className="text-[var(--color-amber)]">.</span>
          </h1>
          <p className="mt-4 max-w-md font-mono text-[12px] leading-relaxed tracking-wide text-[var(--color-ink-2)]">
            Compare two completed scans by bug fingerprint. Exact matches collapse first;
            unmatched bugs get a second pass by Haiku to catch persona-worded duplicates.
          </p>
        </div>

        {completed.length < 2 ? (
          <EmptyState />
        ) : (
          <>
            {/* Selectors */}
            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto_1fr]">
              <RunPicker title="From" runs={completed} selected={idA} onChange={setIdA} />
              <div className="hidden items-end pb-2 text-center md:flex">
                <span className="font-display text-[40px] italic text-[var(--color-ink-3)]">→</span>
              </div>
              <RunPicker title="To" runs={completed} selected={idB} onChange={setIdB} />
            </div>

            {/* Status strip */}
            <div className="mt-10">
              <DiffStatus
                ensuring={ensuring}
                error={error}
                status={diff?.status}
                semanticSkipped={diff?.semanticSkipped}
              />
            </div>

            {computed && (
              <>
                {/* Tally */}
                <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden border border-[var(--color-rule)] bg-[var(--color-rule)] md:grid-cols-3 rise-in">
                  <DiffStat
                    label="Resolved"
                    sub={`gone since ${shortId(idA!)}`}
                    value={computed.onlyA.length}
                    tone="teal"
                  />
                  <DiffStat
                    label="Recurring"
                    sub={`${diff?.exactBoth?.length ?? 0} exact · ${computed.semanticRecurring.length} semantic`}
                    value={computed.totalRecurring}
                    tone="ink"
                  />
                  <DiffStat
                    label="New"
                    sub={`appeared in ${shortId(idB!)}`}
                    value={computed.onlyB.length}
                    tone="amber"
                  />
                </div>

                {/* Per-bucket lists */}
                <div className="mt-12 space-y-12 rise-in rise-delay-1">
                  <BugList title="New since previous scan" accent="amber" bugs={computed.onlyB} />
                  <BugList title="Resolved since previous scan" accent="teal" bugs={computed.onlyA} />
                  {computed.semanticRecurring.length > 0 && (
                    <SemanticPairsList pairs={computed.semanticRecurring} />
                  )}
                  <BugList
                    title="Recurring (exact-match)"
                    accent="ink"
                    bugs={computed.exactRecurring}
                    collapsed
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------

function DiffStatus({
  ensuring,
  error,
  status,
  semanticSkipped,
}: {
  ensuring: boolean;
  error: string | null;
  status?: string;
  semanticSkipped?: string;
}) {
  if (error) {
    return (
      <Banner tone="coral" label="error">
        {error}
      </Banner>
    );
  }
  if (ensuring || !status || status === "requested") {
    return <Banner tone="amber" label="queued" pulse>Waiting for daemon to pick up the diff…</Banner>;
  }
  if (status === "running-exact") {
    return <Banner tone="amber" label="step 1/2" pulse>Computing exact-match diff…</Banner>;
  }
  if (status === "running-semantic") {
    return <Banner tone="amber" label="step 2/2" pulse>Running semantic pass through Haiku…</Banner>;
  }
  if (status === "failed") {
    return <Banner tone="coral" label="failed">The diff couldn&apos;t complete. Try again or pick different scans.</Banner>;
  }
  if (status === "complete") {
    if (semanticSkipped) {
      return <Banner tone="lavender" label="exact only">{`Semantic pass skipped (${semanticSkipped}). Exact-fingerprint results below.`}</Banner>;
    }
    return <Banner tone="teal" label="complete">Exact + semantic diff finished.</Banner>;
  }
  return null;
}

function Banner({
  tone,
  label,
  pulse,
  children,
}: {
  tone: "amber" | "teal" | "coral" | "lavender";
  label: string;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    tone === "amber"    ? "diode--amber" :
    tone === "teal"     ? "diode--teal"  :
    tone === "coral"    ? "diode--coral" :
                          "diode--lav";
  return (
    <div className="flex items-center gap-3 border border-[var(--color-rule)] bg-[var(--color-base-1)] px-4 py-3">
      <span className={`diode ${cls} ${pulse ? "diode--pulse" : ""}`} />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
        {label}
      </span>
      <span className="h-3 w-px bg-[var(--color-rule)]" />
      <span className="font-mono text-[12px] text-[var(--color-ink-1)]">{children}</span>
    </div>
  );
}

function RunPicker({
  title,
  runs,
  selected,
  onChange,
}: {
  title: string;
  runs: Run[];
  selected: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-3)]">{title}</div>
      <div className="space-y-px border border-[var(--color-rule)]">
        {runs.map((r) => {
          const active = r.id === selected;
          return (
            <button
              key={r.id}
              onClick={() => onChange(r.id)}
              className={`flex w-full items-center justify-between px-4 py-3 transition ${
                active ? "bg-[var(--color-amber)]/10" : "bg-[var(--color-base-1)] hover:bg-[var(--color-base-2)]"
              }`}
            >
              <span className="flex items-center gap-3">
                <Diode status={r.status} withLabel={false} />
                <span className="font-mono text-[12px] text-[var(--color-ink-1)]">{shortId(r.id)}</span>
                <span className="font-mono text-[11px] text-[var(--color-ink-3)]">· {relativeTime(r.requestedAt)}</span>
              </span>
              <span className="font-mono text-[12px] tabular-nums text-[var(--color-ink-2)]">
                {typeof r.bugCount === "number" ? `${r.bugCount} bugs` : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DiffStat({
  label,
  sub,
  value,
  tone,
}: {
  label: string;
  sub: string;
  value: number;
  tone: "amber" | "teal" | "ink";
}) {
  return (
    <div className="bg-[var(--color-base-1)] px-7 py-7">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-3)]">{label}</div>
      <div className="mt-3">
        <Numeral value={value} size="lg" tone={tone === "ink" ? "ink" : tone} />
      </div>
      <div className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">{sub}</div>
    </div>
  );
}

function BugList({
  title,
  accent,
  bugs,
  collapsed,
}: {
  title: string;
  accent: "amber" | "teal" | "ink";
  bugs: BugSummary[];
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  const dotCls =
    accent === "amber" ? "diode--amber" :
    accent === "teal"  ? "diode--teal"  :
                          "diode--off";
  return (
    <section>
      <div className="flex items-baseline gap-4">
        <span className={`diode ${dotCls}`} />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-ink-2)]">{title}</h3>
        <span className="font-mono text-[11px] text-[var(--color-ink-3)]">· {bugs.length}</span>
        <span className="h-px flex-1 bg-[var(--color-rule)]" />
        {collapsed && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-3)] hover:text-[var(--color-amber)]"
          >
            {open ? "▾ Hide" : "▸ Show"}
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-3 border border-[var(--color-rule)]">
          {bugs.length === 0 ? (
            <li className="bg-[var(--color-base-1)] px-5 py-4 font-mono text-[11px] text-[var(--color-ink-3)]">none</li>
          ) : (
            bugs.slice(0, 50).map((b, i) => (
              <li
                key={i}
                className="grid grid-cols-[120px_80px_1fr] gap-4 border-b border-[var(--color-rule)] bg-[var(--color-base-1)] px-5 py-3 last:border-b-0"
              >
                <span className="truncate font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">
                  {b.ruleId ?? "—"}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-2)]">
                  {b.severity ?? "—"}
                </span>
                <span className="truncate font-mono text-[11px] text-[var(--color-ink-1)]" title={b.description ?? b.url}>
                  {b.description ?? b.url ?? "—"}
                </span>
              </li>
            ))
          )}
          {bugs.length > 50 && (
            <li className="bg-[var(--color-base-0)] px-5 py-3 font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">
              + {bugs.length - 50} more…
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function SemanticPairsList({ pairs }: { pairs: SemanticPair[] }) {
  return (
    <section>
      <div className="flex items-baseline gap-4">
        <span className="diode diode--lav" />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-ink-2)]">
          Recurring (semantic match)
        </h3>
        <span className="font-mono text-[11px] text-[var(--color-ink-3)]">· {pairs.length}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-lavender)]">
          via haiku
        </span>
        <span className="h-px flex-1 bg-[var(--color-rule)]" />
      </div>
      <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-[var(--color-ink-3)]">
        These pairs of bugs were worded differently between scans, but Haiku judged them to be the same
        underlying issue. Confidence is the model&apos;s own estimate.
      </p>
      <ul className="mt-3 space-y-2">
        {pairs.map((p, i) => (
          <li key={i} className="border border-[var(--color-rule)] bg-[var(--color-base-1)] p-4">
            <div className="flex items-center justify-between border-b border-[var(--color-rule)] pb-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
                pair #{i + 1}
              </span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                  confidence
                </span>
                <ConfidenceBar value={p.confidence} />
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-lavender)]">
                  {Math.round(p.confidence * 100)}%
                </span>
              </span>
            </div>
            <div className="mt-3 grid grid-cols-[60px_1fr] gap-x-4 gap-y-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-teal)]">A</span>
              <BugLine bug={p.bugA} />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-amber)]">B</span>
              <BugLine bug={p.bugB} />
            </div>
            <div className="mt-3 border-t border-[var(--color-rule)] pt-2 font-mono text-[11px] italic text-[var(--color-ink-3)]">
              {p.reason}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BugLine({ bug }: { bug: BugSummary }) {
  return (
    <div className="font-mono text-[11.5px] leading-relaxed">
      <span className="text-[var(--color-ink-3)]">{bug.ruleId ?? "—"}</span>
      <span className="mx-1.5 text-[var(--color-ink-4)]">·</span>
      <span className="text-[var(--color-ink-3)]">{bug.severity ?? "—"}</span>
      {bug.url && (
        <>
          <span className="mx-1.5 text-[var(--color-ink-4)]">·</span>
          <span className="text-[var(--color-ink-3)]">{bug.url}</span>
        </>
      )}
      <div className="mt-1 text-[var(--color-ink-1)]">{bug.description ?? "—"}</div>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  return (
    <span className="inline-flex h-1 w-16 overflow-hidden bg-[var(--color-base-3)]">
      <span
        className="h-full bg-[var(--color-lavender)]"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </span>
  );
}

function SectionLabel({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-ink-3)]">§ {index}</span>
      <span className="h-px flex-1 bg-[var(--color-rule)]" />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-ink-2)]">{title}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-12 bracket-frame border border-dashed border-[var(--color-rule)] bg-[var(--color-base-1)]/40 px-6 py-20 text-center">
      <Numeral value="—" size="lg" tone="muted" />
      <h3 className="mt-4 font-display text-2xl italic text-[var(--color-ink-1)]">
        Need at least two completed scans.
      </h3>
      <p className="mx-auto mt-2 max-w-sm font-mono text-[11.5px] leading-relaxed text-[var(--color-ink-2)]">
        Diff compares bug fingerprints between two complete runs and then asks Haiku to find
        worded-differently duplicates. Initiate two scans, then return.
      </p>
    </div>
  );
}
