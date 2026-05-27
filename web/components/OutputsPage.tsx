"use client";

import { useEffect, useMemo, useState } from "react";
import { listAll, ref, getMetadata, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { useRuns } from "@/lib/runs";
import { relativeTime } from "@/lib/format";
import { Numeral } from "./Numeral";
import { Diode } from "./Diode";

type Artifact = {
  fullPath: string;
  name: string;
  size: number;
  contentType: string;
  url?: string;
};

type RunBundle = {
  runId: string;
  shortId: string;
  artifacts: Artifact[];
};

function shortId(id: string): string {
  return `SC-${id.slice(0, 6).toUpperCase()}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function OutputsPage({ onSelectRun }: { onSelectRun: (id: string) => void }) {
  const { runs } = useRuns(50);
  const [bundles, setBundles] = useState<RunBundle[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reportsRoot = ref(storage, "reports/");
        const top = await listAll(reportsRoot);
        const result = await Promise.all(
          top.prefixes.map(async (folder) => {
            const inner = await listAll(folder);
            const artifacts = await Promise.all(
              inner.items.map(async (item) => {
                const meta = await getMetadata(item);
                return {
                  fullPath: item.fullPath,
                  name: item.name,
                  size: meta.size ?? 0,
                  contentType: meta.contentType ?? "application/octet-stream",
                } as Artifact;
              }),
            );
            return {
              runId: folder.name,
              shortId: shortId(folder.name),
              artifacts: artifacts.sort((a, b) => a.name.localeCompare(b.name)),
            } as RunBundle;
          }),
        );
        if (!cancelled) {
          setBundles(result);
          setLoading(false);
        }
      } catch (e) {
        console.error("[outputs] list failed:", e);
        if (!cancelled) {
          setBundles([]);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Annotate bundles with run metadata (bug count, status, requestedAt)
  const enriched = useMemo(() => {
    if (!bundles) return null;
    const byId = new Map(runs.map((r) => [r.id, r]));
    return bundles
      .map((b) => ({ ...b, run: byId.get(b.runId) }))
      .sort((a, b) => {
        const aTs = a.run?.requestedAt?.toMillis?.() ?? 0;
        const bTs = b.run?.requestedAt?.toMillis?.() ?? 0;
        return bTs - aTs;
      });
  }, [bundles, runs]);

  const totalArtifacts = bundles?.reduce((s, b) => s + b.artifacts.length, 0) ?? 0;

  const openArtifact = async (path: string) => {
    const url = await getDownloadURL(ref(storage, path));
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="dot-grid min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto max-w-[1280px] px-6 pb-24 pt-12">
        <SectionLabel index="01" title="Artifact archive" />

        <div className="mt-6 grid grid-cols-1 items-end gap-8 border-b border-[var(--color-rule)] pb-10 md:grid-cols-[1fr_auto]">
          <div className="rise-in">
            <h1 className="font-display text-[88px] leading-[0.85] italic tracking-[-0.02em]">
              Outputs<span className="text-[var(--color-amber)]">.</span>
            </h1>
            <p className="mt-4 max-w-md font-mono text-[12px] leading-relaxed tracking-wide text-[var(--color-ink-2)]">
              Every HTML report and PDF produced by the daemon. Stored in Firebase Storage,
              versioned by scan ID.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden border border-[var(--color-rule)] bg-[var(--color-rule)] rise-in rise-delay-1">
            <MiniStat label="Sessions" value={(enriched?.length ?? 0).toString().padStart(3, "0")} />
            <MiniStat label="Artifacts" value={totalArtifacts.toString().padStart(3, "0")} />
          </div>
        </div>

        <div className="mt-12">
          <SectionLabel index="02" title="Bundles" />
        </div>

        {loading ? (
          <div className="mt-6 space-y-px border border-[var(--color-rule)]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse bg-[var(--color-base-1)]" />
            ))}
          </div>
        ) : !enriched || enriched.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 rise-in rise-delay-2">
            {enriched.map((b) => (
              <article
                key={b.runId}
                className="bracket-frame border border-[var(--color-rule)] bg-[var(--color-base-1)] p-6"
              >
                <header className="flex items-start justify-between gap-3">
                  <div>
                    <button
                      onClick={() => onSelectRun(b.runId)}
                      className="font-mono text-[12.5px] tracking-wider text-[var(--color-ink-1)] underline-offset-4 hover:text-[var(--color-amber)] hover:underline"
                    >
                      {b.shortId}
                    </button>
                    <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-[var(--color-ink-3)]">
                      {b.run?.status && <Diode status={b.run.status} />}
                      <span>{b.run?.requestedAt ? relativeTime(b.run.requestedAt) : "—"}</span>
                    </div>
                  </div>
                  {typeof b.run?.bugCount === "number" && (
                    <div className="text-right">
                      <Numeral
                        value={b.run.bugCount}
                        size="md"
                        tone={b.run.bugCount > 0 ? "amber" : "muted"}
                      />
                      <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
                        bugs
                      </div>
                    </div>
                  )}
                </header>

                <ul className="mt-5 space-y-px border border-[var(--color-rule)]">
                  {b.artifacts.map((a) => (
                    <li
                      key={a.fullPath}
                      className="flex items-center justify-between bg-[var(--color-base-0)] px-4 py-3 transition hover:bg-[var(--color-base-2)]"
                    >
                      <div className="flex items-center gap-3 font-mono text-[11.5px] text-[var(--color-ink-2)]">
                        <FileGlyph contentType={a.contentType} />
                        <span>{a.name}</span>
                        <span className="text-[var(--color-ink-4)]">·</span>
                        <span className="text-[var(--color-ink-3)]">{formatBytes(a.size)}</span>
                      </div>
                      <button
                        onClick={() => openArtifact(a.fullPath)}
                        className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ink-3)] hover:text-[var(--color-amber)]"
                      >
                        Open ▸
                      </button>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-base-1)] px-5 py-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">{label}</div>
      <div className="mt-2 font-mono text-[16px] tabular-nums text-[var(--color-ink-1)]">{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-6 bracket-frame border border-dashed border-[var(--color-rule)] bg-[var(--color-base-1)]/40 px-6 py-20 text-center">
      <Numeral value="∅" size="lg" tone="muted" />
      <h3 className="mt-4 font-display text-2xl italic text-[var(--color-ink-1)]">No artifacts yet.</h3>
      <p className="mx-auto mt-2 max-w-sm font-mono text-[11.5px] leading-relaxed text-[var(--color-ink-2)]">
        Reports and PDFs appear here once a scan completes.
      </p>
    </div>
  );
}

function FileGlyph({ contentType }: { contentType: string }) {
  const tone =
    contentType.includes("html") ? "text-[var(--color-amber)]" :
    contentType.includes("pdf")  ? "text-[var(--color-coral)]" :
    contentType.includes("json") ? "text-[var(--color-teal)]"  :
                                    "text-[var(--color-ink-3)]";
  const label = contentType.includes("html") ? "HTML"
              : contentType.includes("pdf")  ? "PDF"
              : contentType.includes("json") ? "JSON"
              : "FILE";
  return (
    <span className={`inline-flex h-5 w-9 items-center justify-center border border-current font-mono text-[9px] tracking-[0.18em] ${tone}`}>
      {label}
    </span>
  );
}
