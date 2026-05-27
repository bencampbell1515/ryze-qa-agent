"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useRuns } from "@/lib/runs";
import { readViewFromUrl, pushView, type ViewName } from "@/lib/view";
import { SignInScreen } from "@/components/SignInScreen";
import { Header } from "@/components/Header";
import { SideNav } from "@/components/SideNav";
import { RunList } from "@/components/RunList";
import { RunDetail } from "@/components/RunDetail";
import { OutputsPage } from "@/components/OutputsPage";
import { DiffView } from "@/components/DiffView";
import { PlaceholderPage } from "@/components/PlaceholderPage";

function readRunIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("run");
}

export default function Home() {
  const { user, loading } = useAuth();
  const [runId, setRunId] = useState<string | null>(null);
  const [view, setView] = useState<ViewName>("audits");

  useEffect(() => {
    setRunId(readRunIdFromUrl());
    setView(readViewFromUrl());
    const onPop = () => {
      setRunId(readRunIdFromUrl());
      setView(readViewFromUrl());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const selectRun = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("run", id);
    url.searchParams.delete("view");
    window.history.pushState({}, "", url);
    setRunId(id);
    setView("audits");
  }, []);

  const clearRun = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("run");
    window.history.pushState({}, "", url);
    setRunId(null);
  }, []);

  const navigateView = useCallback((v: ViewName) => {
    pushView(v);
    setRunId(null);
    setView(v);
  }, []);

  if (loading) {
    return (
      <div className="dot-grid flex min-h-screen items-center justify-center">
        <span className="diode diode--amber diode--pulse" />
      </div>
    );
  }

  if (!user) {
    return <SignInScreen />;
  }

  return <AuthedShell runId={runId} view={view} onSelectRun={selectRun} onClearRun={clearRun} onNavigate={navigateView} />;
}

function AuthedShell({
  runId,
  view,
  onSelectRun,
  onClearRun,
  onNavigate,
}: {
  runId: string | null;
  view: ViewName;
  onSelectRun: (id: string) => void;
  onClearRun: () => void;
  onNavigate: (v: ViewName) => void;
}) {
  const { runs } = useRuns(20);
  const anyActive = runs.some((r) => r.status === "running" || r.status === "requested" || r.status === "cancel-requested");

  return (
    <div className="min-h-screen">
      <Header onLogoClick={onClearRun} active={anyActive} />
      <div className="flex">
        <SideNav current={view} onChange={onNavigate} />
        <main className="min-w-0 flex-1">
          {runId ? (
            <RunDetail runId={runId} onBack={onClearRun} />
          ) : (
            <ViewRouter view={view} onSelectRun={onSelectRun} />
          )}
        </main>
      </div>
    </div>
  );
}

function ViewRouter({
  view,
  onSelectRun,
}: {
  view: ViewName;
  onSelectRun: (id: string) => void;
}) {
  switch (view) {
    case "audits":
      return <RunList onSelect={onSelectRun} />;
    case "outputs":
      return <OutputsPage onSelectRun={onSelectRun} />;
    case "diff":
      return <DiffView />;
    case "presets":
      return (
        <PlaceholderPage
          title="Presets"
          blurb="Save your favorite scan configurations as named presets. Trigger a nightly with one click, or share a preset link with the team."
          glyph="≡"
          comingSoon={[
            "Save current scan config as a named preset",
            "One-click rerun from a preset",
            "Schedule a preset to run nightly via cron",
            "Share preset via signed URL",
            "Diff two presets to compare scope",
          ]}
        />
      );
    case "stats":
      return (
        <PlaceholderPage
          title="Stats"
          blurb="Long-term bug trends, scan velocity, daemon health, and Anthropic API spend per session. The shape of the system, not a single run."
          glyph="∿"
          comingSoon={[
            "Bug count timeline (line chart, last 30 days)",
            "Category breakdown (treemap)",
            "Recurring vs new vs fixed (stacked area)",
            "Daemon uptime + crash count",
            "API cost per scan + daily cap warning",
            "Time-to-complete trend",
          ]}
        />
      );
  }
}
