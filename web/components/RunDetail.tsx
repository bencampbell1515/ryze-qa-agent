"use client";

import { useState } from "react";
import { cancelRun, getArtifactDownloadUrl, useRun } from "@/lib/runs";
import { duration, fullTime, relativeTime } from "@/lib/format";
import { Diode } from "./Diode";
import { Numeral } from "./Numeral";
import { LogStream } from "./LogStream";

const STEP_LABEL: Record<string, string> = {
  queued: "Waiting in queue",
  crawl: "Discovering URLs",
  audit: "Running Playwright · agentic personas",
  orchestrate: "Validating · deduping · gating · scoring",
  done: "Complete",
};

const HEADLINE: Record<string, { line1: string; line2: string; accent: "amber" | "teal" | "coral" | "lavender" }> = {
  complete:           { line1: "Audit",   line2: "complete.",     accent: "teal"     },
  running:            { line1: "Audit in",line2: "progress.",     accent: "amber"    },
  requested:          { line1: "Standing",line2: "by.",           accent: "amber"    },
  failed:             { line1: "Audit",   line2: "failed.",       accent: "coral"    },
  cancelled:          { line1: "Audit",   line2: "cancelled.",    accent: "lavender" },
  "cancel-requested": { line1: "Halting", line2: "audit.",        accent: "lavender" },
};

function shortId(id: string): string {
  return `SC-${id.slice(0, 6).toUpperCase()}`;
}

export function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { run, loading } = useRun(runId);
  const [cancelling, setCancelling] = useState(false);

  if (loading) {
    return (
      <div className="dot-grid min-h-[calc(100vh-3.5rem)]">
        <div className="mx-auto max-w-[1280px] px-6 py-12">
          <div className="h-40 animate-pulse border border-[var(--color-rule)] bg-[var(--color-base-1)]/40" />
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="dot-grid min-h-[calc(100vh-3.5rem)]">
        <div className="mx-auto max-w-[1280px] px-6 py-24 text-center">
          <Numeral value="404" size="lg" tone="muted" />
          <p className="mt-4 font-mono text-[12px] uppercase tracking-wider text-[var(--color-ink-2)]">
            Session not found in ledger.
          </p>
          <button
            onClick={onBack}
            className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-amber)] hover:text-[var(--color-ink-1)]"
          >
            ◂ Return to audits
          </button>
        </div>
      </div>
    );
  }

  const isActive = run.status === "running" || run.status === "requested";
  const canCancel = isActive && run.status !== "cancel-requested";
  const head = HEADLINE[run.status] ?? HEADLINE.requested;
  const accentColor =
    head.accent === "amber"    ? "var(--color-amber)" :
    head.accent === "teal"     ? "var(--color-teal)"  :
    head.accent === "coral"    ? "var(--color-coral)" :
    /* lavender */               "var(--color-lavender)";

  const handleCancel = async () => {
    setCancelling(true);
    try { await cancelRun(run.id); } finally { setCancelling(false); }
  };
  const openArtifact = async (gsPath?: string) => {
    if (!gsPath) return;
    const url = await getArtifactDownloadUrl(gsPath);
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="dot-grid min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto max-w-[1280px] px-6 pb-24 pt-12">

        {/* Breadcrumb */}
        <button
          onClick={onBack}
          className="mb-10 inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-3)] transition hover:text-[var(--color-amber)]"
        >
          <span>◂</span> Audits
        </button>

        {/* Top row: meta + actions */}
        <div className="flex flex-wrap items-center justify-between gap-4 rise-in">
          <div className="flex flex-wrap items-center gap-6">
            <Diode status={run.status} size="lg" />
            <span className="font-mono text-[13px] tracking-wider text-[var(--color-ink-1)]">
              {shortId(run.id)}
            </span>
            <span className="font-mono text-[11px] text-[var(--color-ink-3)]" title={fullTime(run.requestedAt)}>
              requested {relativeTime(run.requestedAt)} · {run.requestedBy.split("@")[0]}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canCancel && (
              <BracketButton
                onClick={handleCancel}
                disabled={cancelling}
                tone="lavender"
                label={cancelling ? "Halting…" : "Cancel run"}
              />
            )}
            {run.status === "complete" && (
              <>
                <BracketButton
                  onClick={() => openArtifact(run.reportPath)}
                  disabled={!run.reportPath}
                  tone="amber"
                  label="View HTML"
                />
                <BracketButton
                  onClick={() => openArtifact(run.pdfPath)}
                  disabled={!run.pdfPath}
                  tone="ink"
                  label="Download PDF"
                />
              </>
            )}
          </div>
        </div>

        {/* Editorial headline */}
        <h1 className="mt-12 font-display text-[120px] leading-[0.85] italic tracking-[-0.025em] sm:text-[160px] rise-in rise-delay-1">
          <span className="block text-[var(--color-ink-1)]">{head.line1}</span>
          <span className="block" style={{ color: accentColor }}>{head.line2}</span>
        </h1>

        {/* Section: telemetry */}
        <div className="mt-16 rise-in rise-delay-2">
          <SectionLabel index="03" title="Telemetry" />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden border border-[var(--color-rule)] bg-[var(--color-rule)] md:grid-cols-4 rise-in rise-delay-2">
          <BigStat
            label="Progress"
            value={`${run.progress}`}
            suffix="%"
            accent={head.accent === "teal" ? "teal" : head.accent === "amber" ? "amber" : undefined}
            sub={STEP_LABEL[run.step] ?? run.step}
          />
          <BigStat
            label={isActive && run.step === "audit" ? "URLs scanned" : "URLs discovered"}
            value={
              isActive && run.step === "audit" && typeof run.urlsScanned === "number"
                ? `${run.urlsScanned}`
                : `${run.urlCount ?? "—"}`
            }
            sub={
              isActive && run.step === "audit" && run.urlCount
                ? `crawl pass · ${run.urlCount} total`
                : "www + shop · post-crawl"
            }
          />
          <BigStat
            label="Bugs"
            value={typeof run.bugCount === "number" ? `${run.bugCount}` : "—"}
            accent={typeof run.bugCount === "number" && run.bugCount > 0 ? "amber" : undefined}
            sub={run.status === "complete" ? "post-gate · post-dedup" : "score pass · pending"}
          />
          <BigStat
            label="Elapsed"
            value={run.startedAt ? duration(run.startedAt, run.completedAt) : "—"}
            mono
            sub={run.startedAt ? `init · ${fullTime(run.startedAt)}` : "queued · awaiting daemon"}
          />
        </div>

        {/* Progress bar */}
        <div className={`mt-8 ${isActive ? "scanline" : ""}`}>
          <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
            <span>{STEP_LABEL[run.step] ?? run.step}</span>
            <span>{run.progress.toString().padStart(3, "0")} / 100</span>
          </div>
          <div className="relative mt-3 h-[3px] overflow-hidden bg-[var(--color-base-2)]">
            <div
              className="absolute inset-y-0 left-0 transition-[width] duration-1000 ease-out"
              style={{
                width: `${run.progress}%`,
                background:
                  run.status === "failed"    ? "var(--color-coral)" :
                  run.status === "cancelled" ? "var(--color-lavender)" :
                  run.status === "complete"  ? "var(--color-teal)" :
                                               "var(--color-amber)",
                boxShadow: isActive ? "0 0 16px var(--color-amber-glow)" : undefined,
              }}
            />
          </div>
        </div>

        {/* Error block */}
        {run.errorMessage && (
          <div className="mt-8 border border-[var(--color-coral)]/30 bg-[var(--color-coral)]/[0.04] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-coral)]/80">
              error
            </div>
            <div className="mt-2 font-mono text-[12.5px] leading-relaxed text-[var(--color-coral)]">
              {run.errorMessage}
            </div>
          </div>
        )}

        {/* Section: live log */}
        <div className="mt-16 rise-in rise-delay-3">
          <SectionLabel index="04" title="Live stream" />
        </div>
        <div className="mt-6 rise-in rise-delay-3">
          <LogStream lines={run.logTail ?? []} active={isActive} />
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------

function SectionLabel({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-ink-3)]">§ {index}</span>
      <span className="h-px flex-1 bg-[var(--color-rule)]" />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--color-ink-2)]">{title}</span>
    </div>
  );
}

function BigStat({
  label,
  value,
  suffix,
  sub,
  accent,
  mono,
}: {
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
  accent?: "amber" | "teal";
  mono?: boolean;
}) {
  return (
    <div className="bg-[var(--color-base-1)] px-6 py-7">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-3)]">
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        {mono ? (
          <span className={`font-mono text-3xl tabular-nums ${accent === "amber" ? "text-[var(--color-amber)]" : accent === "teal" ? "text-[var(--color-teal)]" : "text-[var(--color-ink-1)]"}`}>
            {value}
          </span>
        ) : (
          <Numeral value={value} size="lg" tone={accent ?? "ink"} />
        )}
        {suffix && (
          <span className="font-mono text-base text-[var(--color-ink-3)]">{suffix}</span>
        )}
      </div>
      {sub && (
        <div className="mt-3 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-ink-3)]">
          {sub}
        </div>
      )}
    </div>
  );
}

function BracketButton({
  onClick,
  disabled,
  tone,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone: "amber" | "ink" | "lavender";
  label: string;
}) {
  const accent =
    tone === "amber"    ? "var(--color-amber)" :
    tone === "lavender" ? "var(--color-lavender)" :
                          "var(--color-ink-1)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex items-center gap-2 border border-[var(--color-rule)] bg-[var(--color-base-1)]/40 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-ink-1)] transition hover:bg-[var(--color-base-2)] disabled:opacity-40"
      style={{ borderColor: `color-mix(in srgb, ${accent} 30%, transparent)` }}
    >
      <span className="text-[var(--color-ink-3)] transition group-hover:text-[color:var(--accent)]" style={{ ["--accent" as never]: accent }}>[</span>
      <span>{label}</span>
      <span className="text-[var(--color-ink-3)] transition group-hover:text-[color:var(--accent)]" style={{ ["--accent" as never]: accent }}>]</span>
    </button>
  );
}
