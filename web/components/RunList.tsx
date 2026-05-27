"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { startRun, useRuns } from "@/lib/runs";
import { duration, relativeTime } from "@/lib/format";
import type { Run } from "@/lib/schema";
import type { ScanConfig } from "@/lib/scan-config";
import { Diode } from "./Diode";
import { Numeral } from "./Numeral";
import { ScanConfigModal } from "./ScanConfigModal";
import { RunCards } from "./RunCards";
import { useTheme } from "@/lib/theme";

function shortId(id: string): string {
  return `SC-${id.slice(0, 6).toUpperCase()}`;
}

export function RunList({ onSelect }: { onSelect: (runId: string) => void }) {
  const { user } = useAuth();
  const { runs, loading } = useRuns(50);
  const [starting, setStarting] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const { theme } = useTheme();

  const stats = useMemo(() => {
    const lastComplete = runs.find((r) => r.status === "complete");
    const totalBugs = runs.reduce((sum, r) => sum + (r.bugCount ?? 0), 0);
    const activeNow = runs.some((r) => r.status === "running" || r.status === "requested");
    const lastStart = runs[0]?.requestedAt;
    return {
      total: runs.length,
      totalBugs,
      activeNow,
      lastStart,
      lastComplete,
    };
  }, [runs]);

  const handleConfirm = async (config: ScanConfig) => {
    if (!user?.email || starting) return;
    setStarting(true);
    try {
      const id = await startRun(user.email, config);
      setConfigOpen(false);
      onSelect(id);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="dot-grid min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto max-w-[1280px] px-6 pb-24 pt-12">

        {/* Section label */}
        <SectionLabel index="01" title="Active surveillance" />

        {/* Hero row */}
        <div className="mt-6 grid grid-cols-1 items-end gap-8 border-b border-[var(--color-rule)] pb-10 md:grid-cols-[1fr_auto]">
          <div className="rise-in">
            <h1 className="font-display text-[88px] leading-[0.85] italic tracking-[-0.02em] text-[var(--color-ink-1)]">
              Audits<span className="text-[var(--color-amber)]">.</span>
            </h1>
            <p className="mt-4 max-w-md font-mono text-[12px] leading-relaxed tracking-wide text-[var(--color-ink-2)]">
              Automated bug-hunting for <span className="text-[var(--color-ink-1)]">ryzesuperfoods.com</span> and{" "}
              <span className="text-[var(--color-ink-1)]">shop.ryzesuperfoods.com</span>. Each scan crawls 230+ URLs across
              Playwright and five agentic personas.
            </p>
          </div>

          <button
            onClick={() => setConfigOpen(true)}
            disabled={starting}
            className="rise-in rise-delay-1 group relative inline-flex items-center gap-4 self-end border border-[var(--color-amber)]/70 bg-[var(--color-amber)]/[0.06] px-7 py-4 transition hover:bg-[var(--color-amber)]/[0.12] disabled:opacity-50"
            style={{ boxShadow: "inset 0 0 0 1px transparent, 0 0 24px -8px var(--color-amber-glow)" }}
          >
            <span className="diode diode--amber diode--pulse" />
            <span className="font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-amber)]">
              {starting ? "Initiating…" : "Initiate scan"}
            </span>
            <span className="font-mono text-[var(--color-amber)] transition group-hover:translate-x-1">▸</span>
          </button>
        </div>

        {/* Telemetry strip */}
        <div className="grid grid-cols-2 gap-px overflow-hidden border-x border-b border-[var(--color-rule)] bg-[var(--color-rule)] sm:grid-cols-4">
          <Telemetry label="Total scans" value={stats.total.toString().padStart(3, "0")} />
          <Telemetry label="Bugs logged" value={stats.totalBugs.toString()} accent="amber" />
          <Telemetry label="Last activity" value={stats.lastStart ? relativeTime(stats.lastStart) : "—"} />
          <Telemetry label="Daemon" value={stats.activeNow ? "● scanning" : "● standby"} accent={stats.activeNow ? "amber" : "teal"} />
        </div>

        {/* Section label */}
        <div className="mt-16">
          <SectionLabel index="02" title="Session ledger" />
        </div>

        {/* Runs — table in Instrument, cards in Atelier */}
        <div className="mt-6 rise-in rise-delay-2">
          {loading ? (
            <SkeletonList />
          ) : runs.length === 0 ? (
            <EmptyState />
          ) : theme === "atelier" ? (
            <RunCards runs={runs} onSelect={onSelect} />
          ) : (
            <RunTable runs={runs} onSelect={onSelect} />
          )}
        </div>
      </div>

      <ScanConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

// -------------------------------------------------------------------

function SectionLabel({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-ink-3)]">
        § {index}
      </span>
      <span className="h-px flex-1 bg-[var(--color-rule)]" />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-ink-2)]">
        {title}
      </span>
    </div>
  );
}

function Telemetry({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "amber" | "teal";
}) {
  const valueCls =
    accent === "amber" ? "text-[var(--color-amber)]" :
    accent === "teal"  ? "text-[var(--color-teal)]"  :
                         "text-[var(--color-ink-1)]";
  return (
    <div className="bg-[var(--color-base-1)] px-5 py-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
        {label}
      </div>
      <div className={`mt-2 font-mono text-[16px] tabular-nums ${valueCls}`}>
        {value}
      </div>
    </div>
  );
}

function RunTable({ runs, onSelect }: { runs: Run[]; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-x-auto border border-[var(--color-rule)]">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-rule)] bg-[var(--color-base-1)]">
            <Th>ID</Th>
            <Th>State</Th>
            <Th>Started</Th>
            <Th>Duration</Th>
            <Th className="text-right">Bugs</Th>
            <Th>Operator</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r.id)}
              className="group cursor-pointer border-b border-[var(--color-rule)] transition last:border-b-0 hover:bg-[var(--color-base-1)]/60"
            >
              <Td>
                <span className="font-mono text-[12.5px] tracking-wider text-[var(--color-ink-2)] group-hover:text-[var(--color-ink-1)]">
                  {shortId(r.id)}
                </span>
              </Td>
              <Td>
                <Diode status={r.status} />
              </Td>
              <Td>
                <span className="font-mono text-[12px] text-[var(--color-ink-2)]">
                  {relativeTime(r.requestedAt)}
                </span>
              </Td>
              <Td>
                <span className="font-mono text-[12px] tabular-nums text-[var(--color-ink-3)]">
                  {r.startedAt ? duration(r.startedAt, r.completedAt) : "—"}
                </span>
              </Td>
              <Td className="text-right">
                {typeof r.bugCount === "number" ? (
                  <Numeral value={r.bugCount} size="sm" tone={r.bugCount > 0 ? "amber" : "muted"} />
                ) : (
                  <span className="font-mono text-[14px] tabular-nums text-[var(--color-ink-4)]">—</span>
                )}
              </Td>
              <Td>
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">
                  {r.requestedBy.split("@")[0]}
                </span>
              </Td>
              <Td className="w-10 text-right">
                <span className="font-mono text-[var(--color-ink-4)] transition group-hover:translate-x-1 group-hover:text-[var(--color-amber)]">
                  ▸
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)] ${className ?? ""}`}>
      {children}
    </th>
  );
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-5 py-4 align-middle ${className ?? ""}`}>{children}</td>;
}

function EmptyState() {
  return (
    <div className="bracket-frame border border-dashed border-[var(--color-rule)] bg-[var(--color-base-1)]/40 px-6 py-20 text-center">
      <Numeral value="—" size="lg" tone="muted" />
      <h3 className="mt-4 font-display text-2xl italic text-[var(--color-ink-1)]">
        No sessions logged.
      </h3>
      <p className="mx-auto mt-2 max-w-sm font-mono text-[11.5px] leading-relaxed text-[var(--color-ink-2)]">
        Arm a scan above. The pipeline runs locally and typically completes in 1–4 hours.
      </p>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-px border border-[var(--color-rule)]">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse bg-[var(--color-base-1)]" />
      ))}
    </div>
  );
}
