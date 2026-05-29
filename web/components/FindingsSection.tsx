"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchFindings, fetchHygiene } from "@/lib/runs";
import type { Finding, HygieneFinding, Run } from "@/lib/schema";
import { FindingsList } from "./FindingsList";
import { HygieneEntry } from "./HygieneEntry";

type TabKey = "main" | "uncertain" | "suppressed" | "hygiene";

type TabDef = {
  key: TabKey;
  label: string;
  count?: number;
  path?: string;
  kind: "findings" | "hygiene";
  badge?: string;
};

/** Returns the tabs that have data (count > 0 or a path present). Legacy runs
 *  predating N1 have neither, so this returns [] and the section hides. */
function visibleTabs(run: Run): TabDef[] {
  const defs: TabDef[] = [
    { key: "main", label: "Main", count: run.findingsCount, path: run.findingsJsonPath, kind: "findings" },
    {
      key: "uncertain",
      label: "Needs review",
      count: run.uncertainCount,
      path: run.uncertainFindingsJsonPath,
      kind: "findings",
      badge: "REVIEW",
    },
    {
      key: "suppressed",
      label: "Suppressed",
      count: run.suppressedCount,
      path: run.suppressedFindingsJsonPath,
      kind: "findings",
    },
    { key: "hygiene", label: "Hygiene", count: run.hygieneCount, path: run.hygieneJsonPath, kind: "hygiene" },
  ];
  return defs.filter((t) => (t.count ?? 0) > 0 || !!t.path);
}

export function FindingsSection({ run }: { run: Run }) {
  const tabs = useMemo(() => visibleTabs(run), [run]);
  // `clicked` is the user's explicit selection (null until they pick one). The
  // effective tab is derived, defaulting to the first available — Main, else the
  // first present tier. Suppressed/hygiene are never the default while a higher
  // tier exists, and their content isn't fetched until clicked, satisfying the
  // "collapsed by default" intent. Deriving (not an effect) keeps render clean.
  const [clicked, setClicked] = useState<TabKey | null>(null);

  if (tabs.length === 0) return null;

  const activeDef =
    (clicked && tabs.find((t) => t.key === clicked)) || tabs[0];
  const setActive = setClicked;

  return (
    <div>
      <div className="mt-16 rise-in">
        <SectionLabel index="05" title="Findings" />
      </div>

      {/* Counts strip */}
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 rise-in">
        {tabs.map((t) => (
          <span key={t.key} className="font-mono text-[11px] text-[var(--color-ink-3)]">
            <span className="text-[var(--color-ink-1)]">{t.count ?? 0}</span>{" "}
            {t.label.toLowerCase()}
          </span>
        ))}
      </div>

      {/* Tab bar */}
      <div className="mt-6 flex flex-wrap gap-px border-b border-[var(--color-rule)]">
        {tabs.map((t) => {
          const isActive = t.key === activeDef.key;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`relative flex items-center gap-2 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] transition ${
                isActive
                  ? "text-[var(--color-ink-1)]"
                  : "text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]"
              }`}
            >
              <span>{t.label}</span>
              <span className="text-[var(--color-ink-3)]">{t.count ?? 0}</span>
              {t.badge && (
                <span className="rounded-sm bg-[var(--color-lavender)]/15 px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-[var(--color-lavender)]">
                  {t.badge}
                </span>
              )}
              {isActive && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--color-amber)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab body — keyed so each tab lazily fetches its own data. */}
      <div className="mt-6">
        <TabBody key={activeDef.key} tab={activeDef} cropsPrefix={run.cropsPrefix} />
      </div>
    </div>
  );
}

// -------------------------------------------------------------------

function TabBody({ tab, cropsPrefix }: { tab: TabDef; cropsPrefix?: string }) {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [hygiene, setHygiene] = useState<HygieneFinding[] | null>(null);
  const [loading, setLoading] = useState(true);

  // TabBody is keyed by tab in the parent, so it remounts per tab — initial
  // `loading: true` is correct and there's no need to reset it synchronously.
  useEffect(() => {
    let cancelled = false;
    if (tab.kind === "hygiene") {
      fetchHygiene(tab.path).then((h) => {
        if (!cancelled) {
          setHygiene(h);
          setLoading(false);
        }
      });
    } else {
      fetchFindings(tab.path).then((f) => {
        if (!cancelled) {
          setFindings(f);
          setLoading(false);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [tab.kind, tab.path]);

  if (loading) {
    return (
      <div className="h-24 animate-pulse border border-[var(--color-rule)] bg-[var(--color-base-1)]/40" />
    );
  }

  if (tab.kind === "hygiene") {
    const entries = hygiene ?? [];
    if (entries.length === 0) {
      return (
        <p className="border border-dashed border-[var(--color-rule)] bg-[var(--color-base-1)]/40 px-5 py-8 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          No hygiene exclusions recorded.
        </p>
      );
    }
    return (
      <>
        <p className="mb-3 font-mono text-[10.5px] leading-relaxed text-[var(--color-ink-3)]">
          URLs excluded from the audit (drafts, deny-list matches, stale Replo blocks).
          Reference material — not shopper-facing bugs.
        </p>
        <ul className="border border-[var(--color-rule)]">
          {entries.map((e) => (
            <HygieneEntry key={e.id} entry={e} />
          ))}
        </ul>
      </>
    );
  }

  return <FindingsList findings={findings ?? []} cropsPrefix={cropsPrefix} />;
}

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
