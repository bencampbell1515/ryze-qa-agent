"use client";

import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export function Header({
  onLogoClick,
  active = false,
}: {
  onLogoClick?: () => void;
  active?: boolean;
}) {
  const { user, signOut } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-rule)] bg-[var(--color-base-0)]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-6">
        <button
          onClick={onLogoClick}
          className="group flex items-center gap-3 text-left transition"
        >
          <span className={`diode diode--${active ? "amber" : "teal"} ${active ? "diode--pulse" : ""}`} />
          <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-ink-2)] transition group-hover:text-[var(--color-ink-1)]">
            Ryze · QA
          </span>
          <span className="hidden font-display text-[15px] italic text-[var(--color-ink-2)] sm:inline">
            Instrument
          </span>
        </button>

        <div className="flex items-center gap-5">
          <button
            onClick={toggle}
            title={`Switch to ${theme === "instrument" ? "Atelier" : "Instrument"} theme`}
            className="group inline-flex items-center gap-2 border border-[var(--color-rule)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-2)] transition hover:border-[var(--color-amber)] hover:text-[var(--color-amber)]"
          >
            <span aria-hidden>{theme === "instrument" ? "◐" : "◑"}</span>
            <span>{theme === "instrument" ? "Instrument" : "Atelier"}</span>
          </button>
          {user && (
            <span className="hidden font-mono text-[11px] tracking-wider text-[var(--color-ink-3)] sm:inline">
              {user.email}
            </span>
          )}
          {user && (
            <button
              onClick={signOut}
              className="group inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-2)] transition hover:text-[var(--color-ink-1)]"
            >
              <span className="text-[var(--color-ink-3)] transition group-hover:text-[var(--color-amber)]">[</span>
              <span>Sign out</span>
              <span className="text-[var(--color-ink-3)] transition group-hover:text-[var(--color-amber)]">]</span>
            </button>
          )}
        </div>
      </div>

      {/* Active-run scanline */}
      {active && (
        <div className="h-px scanline" style={{ background: "var(--color-rule)" }} />
      )}
    </header>
  );
}
