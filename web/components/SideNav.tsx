"use client";

import type { ViewName } from "@/lib/view";

type NavItem = {
  id: ViewName;
  label: string;
  icon: React.ReactNode;
};

const ITEMS: NavItem[] = [
  { id: "audits",  label: "Audits",  icon: <AuditIcon /> },
  { id: "outputs", label: "Outputs", icon: <OutputsIcon /> },
  { id: "presets", label: "Presets", icon: <PresetsIcon /> },
  { id: "diff",    label: "Diff",    icon: <DiffIcon /> },
  { id: "stats",   label: "Stats",   icon: <StatsIcon /> },
];

export function SideNav({
  current,
  onChange,
}: {
  current: ViewName;
  onChange: (v: ViewName) => void;
}) {
  return (
    <nav className="sticky top-14 z-10 hidden w-[72px] shrink-0 border-r border-[var(--color-rule)] bg-[var(--color-base-0)]/60 backdrop-blur-md md:flex">
      <div className="flex h-[calc(100vh-3.5rem)] w-full flex-col items-center gap-1 py-6">
        {ITEMS.map((item) => {
          const active = item.id === current;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className="group relative flex h-14 w-14 flex-col items-center justify-center gap-1.5 transition"
              title={item.label}
            >
              {/* active indicator */}
              {active && (
                <span
                  aria-hidden
                  className="absolute right-0 h-7 w-px bg-[var(--color-amber)]"
                  style={{ boxShadow: "0 0 8px var(--color-amber-glow)" }}
                />
              )}
              <span
                className={`transition ${
                  active ? "text-[var(--color-amber)]" : "text-[var(--color-ink-3)] group-hover:text-[var(--color-ink-1)]"
                }`}
              >
                {item.icon}
              </span>
              <span
                className={`font-mono text-[9px] uppercase tracking-[0.18em] transition ${
                  active ? "text-[var(--color-ink-1)]" : "text-[var(--color-ink-4)] group-hover:text-[var(--color-ink-2)]"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}

        <div className="mt-auto flex flex-col items-center gap-2 pb-2">
          <span className="h-px w-6 bg-[var(--color-rule)]" />
          <span className="font-mono text-[8.5px] uppercase tracking-[0.24em] text-[var(--color-ink-4)]">v0.1</span>
        </div>
      </div>
    </nav>
  );
}

// -- Icons (hand-drawn line set, 18px viewport) --

function AuditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square">
      <path d="M3 4h12M3 9h12M3 14h7" />
    </svg>
  );
}
function OutputsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square">
      <path d="M2.5 5l2-1.5h4l1.5 1.5h5.5v9.5h-13z" />
      <path d="M5 9.5h8M5 12h5" />
    </svg>
  );
}
function PresetsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square">
      <path d="M3 4.5h12M3 9h12M3 13.5h12" />
      <circle cx="6"  cy="4.5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="9"   r="1.6" fill="currentColor" />
      <circle cx="7"  cy="13.5" r="1.6" fill="currentColor" />
    </svg>
  );
}
function DiffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square">
      <path d="M9 2v14M3 6l-1.5 1.5L3 9M15 9l1.5 1.5L15 12" />
    </svg>
  );
}
function StatsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square">
      <path d="M3 15V8M7 15V4M11 15v-7M15 15v-4" />
    </svg>
  );
}
